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
import { loadConfig } from '../config/configuration'
import { StorageModule } from '../storage/storage.module'
import { EntriesModule } from './entries.module'
import { Entry } from './entry.entity'
import { Attachment } from '../attachments/attachment.entity'

/**
 * Integration test: boots a real Nest app (global ValidationPipe + the real
 * auth guards included, via AuthModule) wired to EntriesModule against an
 * in-memory sql.js (pure-JS SQLite) database, so the full
 * controller -> service -> repository -> TypeORM path — and the auth layer
 * in front of it — is exercised without needing a running Postgres instance
 * for `npm test`. Production still targets Postgres (see
 * database/typeorm.config.ts).
 *
 * StorageModule and the Attachment entity are wired in even though this
 * suite never uploads anything: EntriesService's cascade-delete (#20) needs
 * the FILE_STORAGE token, and EntriesRepository.removeCascade touches the
 * attachments table directly (see entries.repository.ts), so both must be
 * registered for the DELETE lifecycle test below to run at all. The
 * attachments-specific cascade behaviour itself is covered end-to-end in
 * attachments.e2e.test.ts, which already wires up the full upload path.
 */
describe('Entries (e2e)', () => {
  let app: INestApplication
  let auth: AuthenticatedRequestContext

  const validPayload = {
    title: 'Solo tandem jump',
    shape: 'circle',
    activityType: 'Skydiving',
    location: 'Interlaken, Switzerland',
    date: 'Jul 3',
    metric: '4,000m · 45s freefall',
    excerpt: 'Clear skies over the Alps.',
    weather: 'Clear, light wind',
    duration: '45s freefall',
    difficulty: 'Advanced',
    equipment: 'Tandem rig, GoPro',
    participants: 'Solo w/ instructor',
    raw: 'Did the tandem jump over Interlaken today.',
    story: 'The plane door opened onto nothing but glacier and blue.',
    photoHint: 'freefall shot',
    media: ['canopy view', 'landing selfie', 'plane door'],
    mapX: 53,
    mapY: 30,
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            async () => ({
              app: loadConfig({
                DATABASE_URL: 'postgres://unused/in-test',
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
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()

    auth = await loginForTests(app)
  })

  afterAll(async () => {
    await app.close()
  })

  it('rejects an unauthenticated request with 401', async () => {
    await request(app.getHttpServer()).get('/entries').expect(401)
  })

  it('rejects a mutating request without the CSRF header with 403', async () => {
    await request(app.getHttpServer())
      .post('/entries')
      .set('Cookie', auth.cookieHeader)
      .send(validPayload)
      .expect(403)
  })

  it('rejects an invalid create payload with 400', async () => {
    await withAuth(
      request(app.getHttpServer()).post('/entries'),
      auth,
      { mutating: true },
    )
      .send({ ...validPayload, shape: 'hexagon' })
      .expect(400)
  })

  it('supports the full create -> read -> update -> delete lifecycle', async () => {
    const createRes = await withAuth(
      request(app.getHttpServer()).post('/entries'),
      auth,
      { mutating: true },
    )
      .send(validPayload)
      .expect(201)

    expect(createRes.body).toMatchObject({ title: validPayload.title, shape: 'circle' })
    const id = createRes.body.id as number
    expect(typeof id).toBe('number')

    await withAuth(request(app.getHttpServer()).get(`/entries/${id}`), auth)
      .expect(200)
      .expect((res) => {
        expect(res.body.title).toBe(validPayload.title)
      })

    const listRes = await withAuth(request(app.getHttpServer()).get('/entries'), auth).expect(
      200,
    )
    expect(Array.isArray(listRes.body)).toBe(true)
    expect(listRes.body.some((e: { id: number }) => e.id === id)).toBe(true)

    await withAuth(
      request(app.getHttpServer()).patch(`/entries/${id}`),
      auth,
      { mutating: true },
    )
      .send({ title: 'Solo tandem jump (edited)' })
      .expect(200)
      .expect((res) => {
        expect(res.body.title).toBe('Solo tandem jump (edited)')
      })

    await withAuth(
      request(app.getHttpServer()).delete(`/entries/${id}`),
      auth,
      { mutating: true },
    ).expect(204)

    await withAuth(request(app.getHttpServer()).get(`/entries/${id}`), auth).expect(404)
  })

  it('returns 404 for an update or delete on a missing id', async () => {
    await withAuth(
      request(app.getHttpServer()).patch('/entries/999999'),
      auth,
      { mutating: true },
    )
      .send({ title: 'nope' })
      .expect(404)

    await withAuth(
      request(app.getHttpServer()).delete('/entries/999999'),
      auth,
      { mutating: true },
    ).expect(404)
  })
})
