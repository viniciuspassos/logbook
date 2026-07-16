import { MigrationInterface, QueryRunner } from "typeorm";

export class EntryVersioningAndTombstones1784241976959 implements MigrationInterface {
    name = 'EntryVersioningAndTombstones1784241976959'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "entries" ADD "version" integer NOT NULL DEFAULT '1'`);
        await queryRunner.query(`ALTER TABLE "entries" ADD "supersededEdits" text`);
        await queryRunner.query(`ALTER TABLE "entries" ADD "deletedAt" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "entries" DROP COLUMN "deletedAt"`);
        await queryRunner.query(`ALTER TABLE "entries" DROP COLUMN "supersededEdits"`);
        await queryRunner.query(`ALTER TABLE "entries" DROP COLUMN "version"`);
    }

}
