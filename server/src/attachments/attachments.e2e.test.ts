import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import cookieParser from 'cookie-parser'
import { Test } from '@nestjs/testing'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import request from 'supertest'
import { AuthModule } from '../auth/auth.module'
import { Session } from '../auth/session.entity'
import {
  loginForTests,
  testAuthPasswordHash,
  withAuth,
  type AuthenticatedRequestContext,
} from '../auth/test-support/auth-e2e.helper'
import { EntriesModule } from '../entries/entries.module'
import { Entry } from '../entries/entry.entity'
import { AttachmentsModule } from './attachments.module'
import { Attachment } from './attachment.entity'
import { StorageModule } from '../storage/storage.module'
import { loadConfig } from '../config/configuration'

// Real magic bytes for a JPEG (SOI + JFIF marker) — with magic-byte
// validation in place (#19), a fake "jpeg" body of arbitrary text bytes is
// correctly rejected, so lifecycle tests that expect a successful upload
// need genuine signature bytes.
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

describe('Attachments (e2e)', () => {
  let app: INestApplication
  let uploadDir: string
  let entryId: number
  let auth: AuthenticatedRequestContext

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logbook-attachments-e2e-'))

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            async () => ({
              app: loadConfig({
                DATABASE_URL: 'postgres://unused/in-test',
                UPLOAD_DIR: uploadDir,
                AUTH_PASSWORD_HASH: await testAuthPasswordHash(),
              }),
            }),
          ],
        }),
        TypeOrmModule.forRoot({
          type: 'sqljs',
          autoSave: false,
          synchronize: true,
          entities: [Entry, Attachment, Session],
        }),
        StorageModule,
        AuthModule,
        EntriesModule,
        AttachmentsModule,
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()

    auth = await loginForTests(app)

    const entryRes = await withAuth(request(app.getHttpServer()).post('/entries'), auth, {
      mutating: true,
    }).send({
      title: 'Pico da Bandeira',
      shape: 'triangle',
      location: 'Espírito Santo, Brazil',
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
    })
    entryId = entryRes.body.id as number
  })

  afterAll(async () => {
    await app.close()
    await fs.rm(uploadDir, { recursive: true, force: true })
  })

  it('rejects an unauthenticated upload with 401', async () => {
    await request(app.getHttpServer())
      .post(`/entries/${entryId}/attachments`)
      .attach('file', Buffer.from('bytes'), 'summit.jpg')
      .expect(401)
  })

  it('rejects an upload without the CSRF header with 403', async () => {
    await request(app.getHttpServer())
      .post(`/entries/${entryId}/attachments`)
      .set('Cookie', auth.cookieHeader)
      .attach('file', Buffer.from('bytes'), 'summit.jpg')
      .expect(403)
  })

  it('returns 404 uploading to a nonexistent entry', async () => {
    await withAuth(
      request(app.getHttpServer()).post('/entries/999999/attachments'),
      auth,
      { mutating: true },
    )
      .attach('file', Buffer.from('bytes'), 'summit.jpg')
      .expect(404)
  })

  it('returns 400 when no file field is sent', async () => {
    await withAuth(
      request(app.getHttpServer()).post(`/entries/${entryId}/attachments`),
      auth,
      { mutating: true },
    ).expect(400)
  })

  it('supports the full upload -> list -> metadata -> download -> delete lifecycle', async () => {
    const uploadRes = await withAuth(
      request(app.getHttpServer()).post(`/entries/${entryId}/attachments`),
      auth,
      { mutating: true },
    )
      .attach('file', JPEG_BYTES, {
        filename: 'summit.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201)

    expect(uploadRes.body).toMatchObject({
      entryId,
      originalFilename: 'summit.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: JPEG_BYTES.byteLength,
    })
    const attachmentId = uploadRes.body.id as number

    const listRes = await withAuth(
      request(app.getHttpServer()).get(`/entries/${entryId}/attachments`),
      auth,
    ).expect(200)
    expect(listRes.body).toHaveLength(1)
    expect(listRes.body[0].id).toBe(attachmentId)

    await withAuth(request(app.getHttpServer()).get(`/attachments/${attachmentId}`), auth)
      .expect(200)
      .expect((res) => {
        expect(res.body.originalFilename).toBe('summit.jpg')
      })

    const fileRes = await withAuth(
      request(app.getHttpServer()).get(`/attachments/${attachmentId}/file`),
      auth,
    ).expect(200)
    expect(fileRes.headers['content-type']).toContain('image/jpeg')
    expect(fileRes.headers['x-content-type-options']).toBe('nosniff')
    expect(fileRes.headers['content-disposition']).toContain('inline;')
    expect(fileRes.body.equals(JPEG_BYTES)).toBe(true)

    await withAuth(
      request(app.getHttpServer()).delete(`/attachments/${attachmentId}`),
      auth,
      { mutating: true },
    ).expect(204)

    await withAuth(
      request(app.getHttpServer()).get(`/attachments/${attachmentId}`),
      auth,
    ).expect(404)
    await withAuth(
      request(app.getHttpServer()).get(`/attachments/${attachmentId}/file`),
      auth,
    ).expect(404)
  })

  it('rejects an HTML payload uploaded with a spoofed image/png Content-Type, and never stores it (#19)', async () => {
    const htmlPayload = Buffer.from(
      '<html><body><script>alert(document.cookie)</script></body></html>',
      'utf-8',
    )

    const uploadRes = await withAuth(
      request(app.getHttpServer()).post(`/entries/${entryId}/attachments`),
      auth,
      { mutating: true },
    )
      .attach('file', htmlPayload, {
        filename: 'totally-a-photo.png',
        contentType: 'image/png',
      })
      .expect(415)

    expect(JSON.stringify(uploadRes.body)).not.toContain('<script>')

    const listRes = await withAuth(
      request(app.getHttpServer()).get(`/entries/${entryId}/attachments`),
      auth,
    ).expect(200)
    expect(listRes.body).toHaveLength(0)
  })
})
