import { MigrationInterface, QueryRunner } from "typeorm";

export class Baseline1784237450897 implements MigrationInterface {
    name = 'Baseline1784237450897'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "entries" ("id" SERIAL NOT NULL, "title" character varying NOT NULL, "shape" character varying NOT NULL, "activityType" character varying, "location" character varying NOT NULL, "date" character varying NOT NULL, "metric" character varying NOT NULL, "excerpt" character varying NOT NULL, "weather" character varying NOT NULL, "duration" character varying NOT NULL, "difficulty" character varying NOT NULL, "equipment" character varying NOT NULL, "participants" character varying NOT NULL, "raw" text NOT NULL, "story" text NOT NULL, "photoHint" character varying NOT NULL, "media" text NOT NULL, "mapX" double precision NOT NULL, "mapY" double precision NOT NULL, "userId" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_23d4e7e9b58d9939f113832915b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "attachments" ("id" SERIAL NOT NULL, "entryId" integer NOT NULL, "originalFilename" character varying NOT NULL, "storageKey" character varying NOT NULL, "mimeType" character varying NOT NULL, "sizeBytes" integer NOT NULL, "userId" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5e1f050bcff31e3084a1d662412" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "sessions" ("id" SERIAL NOT NULL, "tokenHash" character varying NOT NULL, "csrfToken" character varying NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_bace6c68efc156fddac9b14bda2" UNIQUE ("tokenHash"), CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "sessions"`);
        await queryRunner.query(`DROP TABLE "attachments"`);
        await queryRunner.query(`DROP TABLE "entries"`);
    }

}
