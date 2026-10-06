import cookieParser from 'cookie-parser'
import { Test } from '@nestjs/testing'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import request from 'supertest'
import { Attachment } from '../attachments/attachment.entity'
import { loadConfig } from '../config/configuration'
import { EntriesModule } from '../entries/entries.module'
import { Entry } from '../entries/entry.entity'
import { StorageModule } from '../storage/storage.module'
import { User } from '../users/user.entity'
import { AuthModule } from './auth.module'
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from './cookies'
import { Session } from './session.entity'

/**
 * The same real app wiring as auth.e2e.test.ts, booted with the feature flag
 * OFF and none of the Google vars set: the API must stay closed (no session
 * can ever be created) while /auth/config and logout keep working.
 */
describe('Auth with GOOGLE_AUTH_ENABLED=false (e2e)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              app: loadConfig({
                DATABASE_URL: 'postgres://unused/in-test',
                GOOGLE_AUTH_ENABLED: 'false',
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
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    app.use(cookieParser())
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /auth/config is public and reports Google login off, without any client ID', async () => {
    const res = await request(app.getHttpServer()).get('/auth/config').expect(200)

    expect(res.body).toEqual({ googleEnabled: false })
  })

  it('POST /auth/google answers 404 for a well-formed body, a malformed one and an empty one', async () => {
    await request(app.getHttpServer())
      .post('/auth/google')
      .send({ idToken: 'anything' })
      .expect(404)
    await request(app.getHttpServer()).post('/auth/google').send({ nope: 1 }).expect(404)
    const res = await request(app.getHttpServer()).post('/auth/google').expect(404)

    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('keeps protected routes closed: 401 for /auth/me and /entries, even with a forged session cookie', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401)
    await request(app.getHttpServer()).get('/entries').expect(401)
    await request(app.getHttpServer())
      .get('/entries')
      .set('Cookie', `${SESSION_COOKIE_NAME}=forged`)
      .expect(401)
  })

  it('POST /auth/logout still answers 200 and clears both cookies', async () => {
    const res = await request(app.getHttpServer()).post('/auth/logout').expect(200)

    const cleared = res.headers['set-cookie'] as unknown as string[]
    expect(cleared.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=;`))).toBe(true)
    expect(cleared.some((c) => c.startsWith(`${CSRF_COOKIE_NAME}=;`))).toBe(true)
  })
})
