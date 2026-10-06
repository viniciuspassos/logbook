import { MigrationInterface, QueryRunner } from "typeorm";

export class EmailAndSessionIndexes1791308962107 implements MigrationInterface {
    name = 'EmailAndSessionIndexes1791308962107'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Hand-edited: normalise any e-mail stored before the service started
        // trimming/lowercasing on write, so the allowlist and legacy-owner
        // comparisons are exact. The index is deliberately NOT unique: a
        // recycled address held by a new Google account (new `sub`) must not
        // lock that user out. `down` cannot restore the original casing.
        await queryRunner.query(`UPDATE "users" SET "email" = lower(trim("email"))`);
        await queryRunner.query(`CREATE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `);
        await queryRunner.query(`CREATE INDEX "IDX_57de40bc620f456c7311aa3a1e" ON "sessions" ("userId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_57de40bc620f456c7311aa3a1e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
    }

}
