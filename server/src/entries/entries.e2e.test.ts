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
import { AllExceptionsFilter } from '../common/filters/http-exception.filter'
import { StorageModule } from '../storage/storage.module'
import { EntriesModule } from './entries.module'
import { Entry } from './entry.entity'
import { Attachment } from '../attachments/attachment.entity'

/**
 * Integration test: boots a real Nest app (global ValidationPipe + the real
 * auth guards included, via AuthModule, + the real AllExceptionsFilter that
 * main.ts registers in production) wired to EntriesModule against an
 * in-memory sql.js (pure-JS SQLite) database, so the full
 * controller -> service -> repository -> TypeORM path — and the auth and
 * error-response layers in front of it — is exercised without needing a
 * running Postgres instance for `npm test`. Production still targets
 * Postgres (see database/typeorm.config.ts).
 *
 * Registering AllExceptionsFilter here (rather than leaving the default Nest
 * exception handling in place) matters: it's what actually shapes an error
 * response body in production, and a custom exception's `getResponse()`
 * contract alone (see EntryVersionConflictException) isn't the real contract
 * a client sees — the filter's wrapping is. Skipping it let a prior version
 * of this suite pass while asserting a shape the real API never served.
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
    app.useGlobalFilters(new AllExceptionsFilter())
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

  it('supports the full create -> read -> update -> delete lifecycle, versioning each write', async () => {
    const createRes = await withAuth(
      request(app.getHttpServer()).post('/entries'),
      auth,
      { mutating: true },
    )
      .send(validPayload)
      .expect(201)

    expect(createRes.body).toMatchObject({ title: validPayload.title, shape: 'circle', version: 1 })
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
      .send({ version: 1, title: 'Solo tandem jump (edited)' })
      .expect(200)
      .expect((res) => {
        expect(res.body.title).toBe('Solo tandem jump (edited)')
        expect(res.body.version).toBe(2)
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
      .send({ version: 1, title: 'nope' })
      .expect(404)

    await withAuth(
      request(app.getHttpServer()).delete('/entries/999999'),
      auth,
      { mutating: true },
    ).expect(404)
  })

  it('rejects a PATCH with a missing version with 400', async () => {
    const createRes = await withAuth(
      request(app.getHttpServer()).post('/entries'),
      auth,
      { mutating: true },
    )
      .send(validPayload)
      .expect(201)
    const id = createRes.body.id as number

    await withAuth(
      request(app.getHttpServer()).patch(`/entries/${id}`),
      auth,
      { mutating: true },
    )
      .send({ title: 'no version field' })
      .expect(400)
  })

  it('409s on a stale version, hands back the current server state, and does not apply the write (#24)', async () => {
    const createRes = await withAuth(
      request(app.getHttpServer()).post('/entries'),
      auth,
      { mutating: true },
    )
      .send(validPayload)
      .expect(201)
    const id = createRes.body.id as number

    // Advance the server's version to 2 without the "other device" knowing.
    await withAuth(
      request(app.getHttpServer()).patch(`/entries/${id}`),
      auth,
      { mutating: true },
    )
      .send({ version: 1, title: 'Edited from device A' })
      .expect(200)

    // A second device still thinks the version is 1 and tries to write.
    const conflictRes = await withAuth(
      request(app.getHttpServer()).patch(`/entries/${id}`),
      auth,
      { mutating: true },
    )
      .send({ version: 1, title: 'Edited from device B (stale)' })
      .expect(409)

    expect(conflictRes.body.currentEntry).toMatchObject({
      id,
      version: 2,
      title: 'Edited from device A',
    })

    // The stale write from device B never landed.
    await withAuth(request(app.getHttpServer()).get(`/entries/${id}`), auth)
      .expect(200)
      .expect((res) => {
        expect(res.body.title).toBe('Edited from device A')
        expect(res.body.version).toBe(2)
      })
  })

  it('preserves a losing edit via supersededEdit on the follow-up PATCH that resolves a conflict, rather than discarding it (#24)', async () => {
    const createRes = await withAuth(
      request(app.getHttpServer()).post('/entries'),
      auth,
      { mutating: true },
    )
      .send(validPayload)
      .expect(201)
    const id = createRes.body.id as number

    await withAuth(
      request(app.getHttpServer()).patch(`/entries/${id}`),
      auth,
      { mutating: true },
    )
      .send({ version: 1, title: 'Edited from device A' })
      .expect(200)

    const conflictRes = await withAuth(
      request(app.getHttpServer()).patch(`/entries/${id}`),
      auth,
      { mutating: true },
    )
      .send({ version: 1, title: 'Edited from device B (stale)' })
      .expect(409)
    const currentVersion = conflictRes.body.currentEntry.version as number

    // Device B resolves by accepting the server's winning text, but stashes
    // its own losing draft rather than throwing it away.
    const resolvedRes = await withAuth(
      request(app.getHttpServer()).patch(`/entries/${id}`),
      auth,
      { mutating: true },
    )
      .send({
        version: currentVersion,
        title: 'Edited from device A',
        supersededEdit: { title: 'Edited from device B (stale)' },
      })
      .expect(200)

    expect(resolvedRes.body.supersededEdits).toEqual([
      {
        version: currentVersion,
        capturedAt: expect.any(String),
        data: { title: 'Edited from device B (stale)' },
      },
    ])
  })

  it('excludes a tombstoned entry from the list and every read/write path, and 404s a delete of an already-deleted entry (#24)', async () => {
    const createRes = await withAuth(
      request(app.getHttpServer()).post('/entries'),
      auth,
      { mutating: true },
    )
      .send(validPayload)
      .expect(201)
    const id = createRes.body.id as number

    await withAuth(
      request(app.getHttpServer()).delete(`/entries/${id}`),
      auth,
      { mutating: true },
    ).expect(204)

    await withAuth(request(app.getHttpServer()).get(`/entries/${id}`), auth).expect(404)

    const listRes = await withAuth(request(app.getHttpServer()).get('/entries'), auth).expect(200)
    expect(listRes.body.some((e: { id: number }) => e.id === id)).toBe(false)

    await withAuth(
      request(app.getHttpServer()).patch(`/entries/${id}`),
      auth,
      { mutating: true },
    )
      .send({ version: 1, title: 'resurrection attempt' })
      .expect(404)

    // Deleting an already-tombstoned entry again is a 404, not a silent
    // success or a second tombstone.
    await withAuth(
      request(app.getHttpServer()).delete(`/entries/${id}`),
      auth,
      { mutating: true },
    ).expect(404)
  })
})
