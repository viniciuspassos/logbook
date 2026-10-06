import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import cookieParser from 'cookie-parser'
import { Test } from '@nestjs/testing'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import request from 'supertest'
import { DataSource } from 'typeorm'
import { Attachment } from '../attachments/attachment.entity'
import { AttachmentsModule } from '../attachments/attachments.module'
import { AuthModule } from '../auth/auth.module'
import { GoogleTokenVerifier } from '../auth/google-token-verifier.service'
import { Session } from '../auth/session.entity'
import {
  TEST_AUTH_ENV,
  TEST_USER_A_EMAIL,
  TEST_USER_B_EMAIL,
  fakeGoogleTokenVerifier,
  loginForTests,
  withAuth,
  type AuthenticatedRequestContext,
} from '../auth/test-support/auth-e2e.helper'
import { AllExceptionsFilter } from '../common/filters/http-exception.filter'
import { loadConfig } from '../config/configuration'
import { EntriesModule } from '../entries/entries.module'
import { Entry } from '../entries/entry.entity'
import { StorageModule } from '../storage/storage.module'
import { User } from './user.entity'

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

const entryPayload = {
  title: 'Pico da Bandeira',
  shape: 'triangle',
  location: 'Espirito Santo, Brazil',
  date: 'Jun 21',
  metric: '2,892m',
  excerpt: 'excerpt',
  weather: 'Windy',
  duration: '6h',
  difficulty: 'Moderate',
  equipment: 'boots',
  participants: 'solo',
  raw: 'raw',
  story: 'story',
  photoHint: 'hint',
  media: ['a', 'b', 'c'],
  mapX: 40,
  mapY: 60,
}

/**
 * Two real signed-in users against the real controllers/guards/repositories:
 * everything user A owns must be invisible to user B, and every cross-user
 * id must answer 404 (not 403), so B can't even learn that an id exists.
 */
describe('Per-user isolation (e2e)', () => {
  let app: INestApplication
  let dataSource: DataSource
  let uploadDir: string
  let userA: AuthenticatedRequestContext
  let userB: AuthenticatedRequestContext
  let entryId: number
  let attachmentId: number

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logbook-isolation-e2e-'))

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              app: loadConfig({
                DATABASE_URL: 'postgres://unused/in-test',
                UPLOAD_DIR: uploadDir,
                ...TEST_AUTH_ENV,
              }),
            }),
          ],
        }),
        TypeOrmModule.forRoot({
          type: 'sqljs',
          autoSave: false,
          synchronize: true,
          entities: [Entry, Attachment, Session, User],
        }),
        StorageModule,
        AuthModule,
        EntriesModule,
        AttachmentsModule,
      ],
    })
      .overrideProvider(GoogleTokenVerifier)
      .useValue(fakeGoogleTokenVerifier)
      .compile()

    dataSource = moduleRef.get(DataSource)
    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    app.useGlobalFilters(new AllExceptionsFilter())
    await app.init()

    userA = await loginForTests(app, TEST_USER_A_EMAIL)
    userB = await loginForTests(app, TEST_USER_B_EMAIL)

    const entryRes = await withAuth(request(app.getHttpServer()).post('/entries'), userA, {
      mutating: true,
    })
      .send(entryPayload)
      .expect(201)
    entryId = entryRes.body.id as number

    const uploadRes = await withAuth(
      request(app.getHttpServer()).post(`/entries/${entryId}/attachments`),
      userA,
      { mutating: true },
    )
      .attach('file', JPEG_BYTES, 'summit.jpg')
      .expect(201)
    attachmentId = uploadRes.body.id as number
  })

  afterAll(async () => {
    await app.close()
    await fs.rm(uploadDir, { recursive: true, force: true })
  })

  describe("user B cannot reach user A's entry", () => {
    it('does not see it in the list', async () => {
      const res = await withAuth(request(app.getHttpServer()).get('/entries'), userB).expect(200)

      expect(res.body).toEqual([])
    })

    it('gets 404 reading it', async () => {
      await withAuth(request(app.getHttpServer()).get(`/entries/${entryId}`), userB).expect(404)
    })

    it('gets 404 updating it, and the entry is left untouched', async () => {
      await withAuth(request(app.getHttpServer()).patch(`/entries/${entryId}`), userB, {
        mutating: true,
      })
        .send({ version: 1, title: 'Hijacked' })
        .expect(404)

      const res = await withAuth(
        request(app.getHttpServer()).get(`/entries/${entryId}`),
        userA,
      ).expect(200)
      expect(res.body).toMatchObject({ title: 'Pico da Bandeira', version: 1 })
    })

    it('gets 404 deleting it, and the entry survives', async () => {
      await withAuth(request(app.getHttpServer()).delete(`/entries/${entryId}`), userB, {
        mutating: true,
      }).expect(404)

      await withAuth(request(app.getHttpServer()).get(`/entries/${entryId}`), userA).expect(200)
    })
  })

  describe("user B cannot reach user A's attachments", () => {
    it('gets 404 listing the attachments of the entry', async () => {
      await withAuth(
        request(app.getHttpServer()).get(`/entries/${entryId}/attachments`),
        userB,
      ).expect(404)
    })

    it('gets 404 uploading to the entry', async () => {
      await withAuth(
        request(app.getHttpServer()).post(`/entries/${entryId}/attachments`),
        userB,
        { mutating: true },
      )
        .attach('file', JPEG_BYTES, 'intruder.jpg')
        .expect(404)
    })

    it('gets 404 reading the attachment metadata', async () => {
      await withAuth(request(app.getHttpServer()).get(`/attachments/${attachmentId}`), userB).expect(
        404,
      )
    })

    it('gets 404 downloading the attachment file', async () => {
      await withAuth(
        request(app.getHttpServer()).get(`/attachments/${attachmentId}/file`),
        userB,
      ).expect(404)
    })

    it('gets 404 deleting the attachment, and it survives', async () => {
      await withAuth(request(app.getHttpServer()).delete(`/attachments/${attachmentId}`), userB, {
        mutating: true,
      }).expect(404)

      await withAuth(
        request(app.getHttpServer()).get(`/attachments/${attachmentId}/file`),
        userA,
      ).expect(200)
    })
  })

  it("an attachment whose own userId is NULL follows its entry: reachable by the entry's owner, never by another user", async () => {
    await dataSource.getRepository(Attachment).update({ id: attachmentId }, { userId: null })

    const list = await withAuth(
      request(app.getHttpServer()).get(`/entries/${entryId}/attachments`),
      userA,
    ).expect(200)
    expect((list.body as Attachment[]).map((a) => a.id)).toEqual([attachmentId])
    await withAuth(request(app.getHttpServer()).get(`/attachments/${attachmentId}`), userA).expect(
      200,
    )
    await withAuth(
      request(app.getHttpServer()).get(`/attachments/${attachmentId}/file`),
      userA,
    ).expect(200)

    await withAuth(request(app.getHttpServer()).get(`/attachments/${attachmentId}`), userB).expect(
      404,
    )
    await withAuth(
      request(app.getHttpServer()).get(`/attachments/${attachmentId}/file`),
      userB,
    ).expect(404)
  })

  it("user A still sees exactly their own data, and B's entries never leak to A", async () => {
    const bEntry = await withAuth(request(app.getHttpServer()).post('/entries'), userB, {
      mutating: true,
    })
      .send({ ...entryPayload, title: "Bob's climb" })
      .expect(201)

    const listA = await withAuth(request(app.getHttpServer()).get('/entries'), userA).expect(200)
    const listB = await withAuth(request(app.getHttpServer()).get('/entries'), userB).expect(200)

    expect((listA.body as Entry[]).map((e) => e.title)).toEqual(['Pico da Bandeira'])
    expect((listB.body as Entry[]).map((e) => e.title)).toEqual(["Bob's climb"])
    await withAuth(request(app.getHttpServer()).get(`/entries/${bEntry.body.id}`), userA).expect(
      404,
    )
    const attachments = await withAuth(
      request(app.getHttpServer()).get(`/entries/${entryId}/attachments`),
      userA,
    ).expect(200)
    expect(attachments.body).toHaveLength(1)
  })
})
