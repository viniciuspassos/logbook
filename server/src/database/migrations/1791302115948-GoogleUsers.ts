import { MigrationInterface, QueryRunner } from "typeorm";

export class GoogleUsers1791302115948 implements MigrationInterface {
    name = 'GoogleUsers1791302115948'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "users" ("id" SERIAL NOT NULL, "googleSub" character varying NOT NULL, "email" character varying NOT NULL, "name" character varying, "picture" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_980a19e1db3caa55d366a4e2165" UNIQUE ("googleSub"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        // Hand-edited (not generator output): every existing session is a
        // password-login session with no user to point at, and the new
        // NOT NULL "userId" could not be added with rows present. Dropping
        // them just signs everyone out once, which Google sign-in requires anyway.
        await queryRunner.query(`DELETE FROM "sessions"`);
        await queryRunner.query(`ALTER TABLE "sessions" ADD "userId" integer NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_e186b0c87ddac0718d1f6783f9" ON "entries" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_35138b11d46d53c48ed932afa4" ON "attachments" ("userId") `);
        await queryRunner.query(`ALTER TABLE "entries" ADD CONSTRAINT "FK_e186b0c87ddac0718d1f6783f98" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "attachments" ADD CONSTRAINT "FK_35138b11d46d53c48ed932afa47" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sessions" ADD CONSTRAINT "FK_57de40bc620f456c7311aa3a1e6" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "sessions" DROP CONSTRAINT "FK_57de40bc620f456c7311aa3a1e6"`);
        await queryRunner.query(`ALTER TABLE "attachments" DROP CONSTRAINT "FK_35138b11d46d53c48ed932afa47"`);
        await queryRunner.query(`ALTER TABLE "entries" DROP CONSTRAINT "FK_e186b0c87ddac0718d1f6783f98"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_35138b11d46d53c48ed932afa4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e186b0c87ddac0718d1f6783f9"`);
        await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN "userId"`);
        await queryRunner.query(`DROP TABLE "users"`);
    }

}
