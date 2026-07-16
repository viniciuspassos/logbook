import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Test } from '@nestjs/testing'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import request from 'supertest'
import { EntriesModule } from '../entries/entries.module'
import { Entry } from '../entries/entry.entity'
import { AttachmentsModule } from './attachments.module'
import { Attachment } from './attachment.entity'
import { StorageModule } from '../storage/storage.module'
import { loadConfig } from '../config/configuration'

describe('Attachments (e2e)', () => {
  let app: INestApplication
  let uploadDir: string
  let entryId: number

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'logbook-attachments-e2e-'))

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              app: loadConfig({ DATABASE_URL: 'postgres://unused/in-test', UPLOAD_DIR: uploadDir }),
            }),
          ],
        }),
        TypeOrmModule.forRoot({
          type: 'sqljs',
          autoSave: false,
          synchronize: true,
          entities: [Entry, Attachment],
        }),
        StorageModule,
        EntriesModule,
        AttachmentsModule,
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()

    const entryRes = await request(app.getHttpServer())
      .post('/entries')
      .send({
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

  it('returns 404 uploading to a nonexistent entry', async () => {
    await request(app.getHttpServer())
      .post('/entries/999999/attachments')
      .attach('file', Buffer.from('bytes'), 'summit.jpg')
      .expect(404)
  })

  it('returns 400 when no file field is sent', async () => {
    await request(app.getHttpServer()).post(`/entries/${entryId}/attachments`).expect(400)
  })

  it('supports the full upload -> list -> metadata -> download -> delete lifecycle', async () => {
    const uploadRes = await request(app.getHttpServer())
      .post(`/entries/${entryId}/attachments`)
      .attach('file', Buffer.from('fake jpeg bytes'), {
        filename: 'summit.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201)

    expect(uploadRes.body).toMatchObject({
      entryId,
      originalFilename: 'summit.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: Buffer.from('fake jpeg bytes').byteLength,
    })
    const attachmentId = uploadRes.body.id as number

    const listRes = await request(app.getHttpServer())
      .get(`/entries/${entryId}/attachments`)
      .expect(200)
    expect(listRes.body).toHaveLength(1)
    expect(listRes.body[0].id).toBe(attachmentId)

    await request(app.getHttpServer())
      .get(`/attachments/${attachmentId}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.originalFilename).toBe('summit.jpg')
      })

    const fileRes = await request(app.getHttpServer())
      .get(`/attachments/${attachmentId}/file`)
      .expect(200)
    expect(fileRes.headers['content-type']).toContain('image/jpeg')
    expect(fileRes.body.equals(Buffer.from('fake jpeg bytes'))).toBe(true)

    await request(app.getHttpServer()).delete(`/attachments/${attachmentId}`).expect(204)

    await request(app.getHttpServer()).get(`/attachments/${attachmentId}`).expect(404)
    await request(app.getHttpServer()).get(`/attachments/${attachmentId}/file`).expect(404)
  })
})
