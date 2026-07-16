import { Test } from '@nestjs/testing'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import request from 'supertest'
import { EntriesModule } from './entries.module'
import { Entry } from './entry.entity'

/**
 * Integration test: boots a real Nest app (global ValidationPipe included)
 * wired to EntriesModule against an in-memory sql.js (pure-JS SQLite)
 * database, so the full controller -> service -> repository -> TypeORM path
 * is exercised without needing a running Postgres instance for `npm test`.
 * Production still targets Postgres (see database/typeorm.config.ts).
 */
describe('Entries (e2e)', () => {
  let app: INestApplication

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
        TypeOrmModule.forRoot({
          type: 'sqljs',
          autoSave: false,
          synchronize: true,
          entities: [Entry],
        }),
        EntriesModule,
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('rejects an invalid create payload with 400', async () => {
    await request(app.getHttpServer())
      .post('/entries')
      .send({ ...validPayload, shape: 'hexagon' })
      .expect(400)
  })

  it('supports the full create -> read -> update -> delete lifecycle', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/entries')
      .send(validPayload)
      .expect(201)

    expect(createRes.body).toMatchObject({ title: validPayload.title, shape: 'circle' })
    const id = createRes.body.id as number
    expect(typeof id).toBe('number')

    await request(app.getHttpServer())
      .get(`/entries/${id}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.title).toBe(validPayload.title)
      })

    const listRes = await request(app.getHttpServer()).get('/entries').expect(200)
    expect(Array.isArray(listRes.body)).toBe(true)
    expect(listRes.body.some((e: { id: number }) => e.id === id)).toBe(true)

    await request(app.getHttpServer())
      .patch(`/entries/${id}`)
      .send({ title: 'Solo tandem jump (edited)' })
      .expect(200)
      .expect((res) => {
        expect(res.body.title).toBe('Solo tandem jump (edited)')
      })

    await request(app.getHttpServer()).delete(`/entries/${id}`).expect(204)

    await request(app.getHttpServer()).get(`/entries/${id}`).expect(404)
  })

  it('returns 404 for an update or delete on a missing id', async () => {
    await request(app.getHttpServer())
      .patch('/entries/999999')
      .send({ title: 'nope' })
      .expect(404)

    await request(app.getHttpServer()).delete('/entries/999999').expect(404)
  })
})
