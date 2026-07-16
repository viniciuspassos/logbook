import cookieParser from 'cookie-parser'
import { Test } from '@nestjs/testing'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import request from 'supertest'
import { loadConfig } from '../config/configuration'
import { HealthModule } from '../health/health.module'
import { AuthModule } from './auth.module'
import { Session } from './session.entity'
import { SessionsService } from './sessions.service'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, SESSION_COOKIE_NAME } from './cookies'
import { TEST_LOGIN_PASSWORD, testAuthPasswordHash } from './test-support/auth-e2e.helper'

/**
 * Integration test for the auth module in isolation (login/logout, cookie
 * issuance, and the health endpoint's @Public() opt-out). Entries/attachments
 * routes being protected end-to-end is covered by their own e2e suites
 * (see entries/entries.e2e.test.ts, attachments/attachments.e2e.test.ts).
 */
describe('Auth (e2e)', () => {
  let app: INestApplication
  let sessionsService: SessionsService

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
          entities: [Session],
        }),
        AuthModule,
        HealthModule,
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
    sessionsService = moduleRef.get(SessionsService)
  })

  afterAll(async () => {
    await app.close()
  })

  it('reaches /health with no session cookie at all (public route, guards bypassed)', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200)

    expect(res.body.status).toBe('ok')
  })

  it('rejects a login with the wrong password with a generic 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ password: 'not the password' })
      .expect(401)

    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('rejects a login request missing the password field with 400', async () => {
    await request(app.getHttpServer()).post('/auth/login').send({}).expect(400)
  })

  it('logs in with the correct password and sets an httpOnly session cookie plus a readable csrf cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ password: TEST_LOGIN_PASSWORD })
      .expect(200)

    const setCookie = res.headers['set-cookie'] as unknown as string[]
    expect(setCookie.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`) && /HttpOnly/i.test(c))).toBe(
      true,
    )
    expect(
      setCookie.some((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`) && !/HttpOnly/i.test(c)),
    ).toBe(true)
  })

  it('logout clears both cookies and invalidates the session for future requests', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ password: TEST_LOGIN_PASSWORD })
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
