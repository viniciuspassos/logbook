import cookieParser from 'cookie-parser'
import { Test } from '@nestjs/testing'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import request from 'supertest'
import { DataSource } from 'typeorm'
import { Attachment } from '../attachments/attachment.entity'
import { loadConfig } from '../config/configuration'
import { Entry } from '../entries/entry.entity'
import { HealthModule } from '../health/health.module'
import { User } from '../users/user.entity'
import { AuthModule } from './auth.module'
import { Session } from './session.entity'
import { SessionsService } from './sessions.service'
import { GoogleTokenVerifier } from './google-token-verifier.service'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME } from './cookies'
import {
  TEST_AUTH_ENV,
  TEST_STRANGER_EMAIL,
  TEST_USER_A_EMAIL,
  TEST_USER_B_EMAIL,
  fakeGoogleTokenVerifier,
  idTokenFor,
  loginForTests,
  withAuth,
} from './test-support/auth-e2e.helper'

function ownerlessEntry(title: string): Partial<Entry> {
  return {
    title,
    shape: 'circle',
    location: 'somewhere',
    date: 'Jul 3',
    metric: 'm',
    excerpt: 'e',
    weather: 'w',
    duration: 'd',
    difficulty: 'x',
    equipment: 'q',
    participants: 'p',
    raw: 'r',
    story: 's',
    photoHint: 'h',
    media: ['a', 'b', 'c'],
    mapX: 1,
    mapY: 2,
    userId: null,
  }
}

/**
 * Integration test for the auth module in isolation (Google sign-in, cookie
 * issuance, /auth/me, logout, the first-user data claim, and the health
 * endpoint's @Public() opt-out). Per-user scoping of entries/attachments is
 * covered by users/user-isolation.e2e.test.ts. GoogleTokenVerifier is
 * overridden with a fake so no test talks to Google.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication
  let sessionsService: SessionsService
  let dataSource: DataSource

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              app: loadConfig({
                DATABASE_URL: 'postgres://unused/in-test',
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
        AuthModule,
        HealthModule,
      ],
    })
      .overrideProvider(GoogleTokenVerifier)
      .useValue(fakeGoogleTokenVerifier)
      .compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
    sessionsService = moduleRef.get(SessionsService)
    dataSource = moduleRef.get(DataSource)
  })

  afterAll(async () => {
    await app.close()
  })

  it('reaches /health with no session cookie at all (public route, guards bypassed)', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200)

    expect(res.body.status).toBe('ok')
  })

  it('no longer serves the password login route', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ password: 'anything' })
      .expect(404)
  })

  it('rejects an invalid Google ID token with 401 and sets no cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: 'forged' })
      .expect(401)

    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('rejects a sign-in request missing idToken with 400', async () => {
    await request(app.getHttpServer()).post('/auth/google').send({}).expect(400)
  })

  it('rejects a verified Google account that is not allowlisted with 403, no cookie and no user row', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: idTokenFor(TEST_STRANGER_EMAIL) })
      .expect(403)

    expect(res.headers['set-cookie']).toBeUndefined()
    await expect(
      dataSource.getRepository(User).findOneBy({ email: TEST_STRANGER_EMAIL }),
    ).resolves.toBeNull()
  })

  it('signs in an allowlisted account: sets an httpOnly session cookie plus a readable csrf cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: idTokenFor(TEST_USER_A_EMAIL) })
      .expect(200)

    expect(res.body).toEqual({ status: 'ok' })
    const setCookie = res.headers['set-cookie'] as unknown as string[]
    expect(setCookie.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`) && /HttpOnly/i.test(c))).toBe(
      true,
    )
    expect(
      setCookie.some((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`) && !/HttpOnly/i.test(c)),
    ).toBe(true)
  })

  it('signing in twice as the same Google account reuses one user row (matched by sub)', async () => {
    await loginForTests(app, TEST_USER_A_EMAIL)
    await loginForTests(app, TEST_USER_A_EMAIL)

    await expect(
      dataSource.getRepository(User).countBy({ email: TEST_USER_A_EMAIL }),
    ).resolves.toBe(1)
  })

  it('GET /auth/me returns 401 without a session', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401)
  })

  it("GET /auth/me returns the signed-in user's profile", async () => {
    const auth = await loginForTests(app, TEST_USER_A_EMAIL)

    const res = await withAuth(request(app.getHttpServer()).get('/auth/me'), auth).expect(200)

    expect(res.body).toEqual({
      id: expect.any(Number),
      email: TEST_USER_A_EMAIL,
      name: 'alice',
      picture: null,
    })
  })

  it('the first user to sign in inherits every ownerless entry and attachment; a later user takes nothing', async () => {
    const entries = dataSource.getRepository(Entry)
    const attachments = dataSource.getRepository(Attachment)
    const legacyEntry = await entries.save(entries.create(ownerlessEntry('legacy')))
    const legacyAttachment = await attachments.save(
      attachments.create({
        entryId: legacyEntry.id,
        originalFilename: 'a.jpg',
        storageKey: 'k',
        mimeType: 'image/jpeg',
        sizeBytes: 1,
        userId: null,
      }),
    )
    // Everyone signed in earlier in this file is already a user, so wipe the
    // users (and their sessions) to put the app back in its "no accounts yet" state.
    await dataSource.getRepository(Session).clear()
    await dataSource.getRepository(User).clear()

    await loginForTests(app, TEST_USER_A_EMAIL)
    const userA = await dataSource.getRepository(User).findOneByOrFail({ email: TEST_USER_A_EMAIL })

    await expect(entries.findOneByOrFail({ id: legacyEntry.id })).resolves.toMatchObject({
      userId: userA.id,
    })
    await expect(attachments.findOneByOrFail({ id: legacyAttachment.id })).resolves.toMatchObject({
      userId: userA.id,
    })

    const lateOrphan = await entries.save(entries.create(ownerlessEntry('late orphan')))
    await loginForTests(app, TEST_USER_B_EMAIL)

    await expect(entries.findOneByOrFail({ id: lateOrphan.id })).resolves.toMatchObject({
      userId: null,
    })
    await expect(entries.findOneByOrFail({ id: legacyEntry.id })).resolves.toMatchObject({
      userId: userA.id,
    })
  })

  it('logout clears both cookies and invalidates the session for future requests', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: idTokenFor(TEST_USER_A_EMAIL) })
      .expect(200)

    const setCookie = loginRes.headers['set-cookie'] as unknown as string[]
    const cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ')
    const sessionToken = setCookie
      .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
      ?.split(';')[0]
      .split('=')[1]
    const csrfToken = setCookie
      .find((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`))
      ?.split(';')[0]
      .split('=')[1]
    expect(sessionToken).toBeDefined()
    expect(csrfToken).toBeDefined()

    await expect(sessionsService.validate(sessionToken as string)).resolves.not.toBeNull()

    const logoutRes = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookieHeader)
      .set(CSRF_HEADER_NAME, csrfToken as string)
      .expect(200)

    const clearedCookies = logoutRes.headers['set-cookie'] as unknown as string[]
    expect(clearedCookies.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=;`))).toBe(true)

    await expect(sessionsService.validate(sessionToken as string)).resolves.toBeNull()
  })
})
