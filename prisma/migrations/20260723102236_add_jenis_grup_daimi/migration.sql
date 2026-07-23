-- CreateTable
CREATE TABLE "pesantren"."jenis_grup_daimi" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jenis_grup_daimi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jenis_grup_daimi_name_key" ON "pesantren"."jenis_grup_daimi"("name");

-- Seed data: migrasi opsi lama dari sekolah-app/src/constants/daimi.ts (JENIS_DAIMI_OPTIONS)
-- supaya tidak ada opsi yang hilang saat berpindah dari array hardcoded ke tabel terkelola.
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('6ee8b5aa-7dbb-40b5-8687-aea933372621', '1. YIL LİSE') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('3ec70550-4b9c-438c-b834-61c374314ca6', '2. YIL LİSE') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('024f2b8f-c44e-4ecc-99bb-f9bd9d19fe9b', '3. YIL LİSE') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('fae73e76-4cf2-4b32-8973-c6ef21680086', '4. YIL LİSE') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('88a03464-49ec-4be8-a1c4-3adc1819ac89', '1. YIL ORTAOKUL') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('9c3d4786-e15b-4109-b6c9-089e9954b795', '2. YIL ORTAOKUL') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('e95ed3b2-581c-494b-a755-cf5a27193b57', '3. YIL ORTAOKUL') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('21e7c408-0eae-4cc2-a845-29866fb7be42', '4. YIL ORTAOKUL') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('4557ed98-fe1a-42c2-b4dd-a19885cfe896', 'HAFIZLIK') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('b38d87e0-c9e4-47d8-a18b-c2391279851d', 'HAZIRLIK LİSE') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('af15310a-3fc5-48e2-a0af-578d0c51e048', 'HAZIRLIK ORTAOKUL') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('f04ac817-beca-4314-896e-67cb42a6f2ab', 'İBTİDAİ') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('f75edd7d-8a58-4470-a482-ff048a9035d1', 'İHZARİ') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('d025c896-fe42-4dcf-a4d2-23cc7049ed59', 'PRA TEDRİS') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('73bfb6cd-194c-4993-a26b-29d4095ac035', 'TEKAMÜL') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('e5e694e3-f1b9-49f0-a903-c8b0dcb48101', 'TEKAMÜLALTI') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('424a8932-0964-494c-972d-769b70c4e629', 'MÜTALAALIK') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('85da9bbe-bf7b-47d4-9e41-9f2a6d88ca8a', 'MÜTALAALIK LİSE') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('696db732-e59f-464e-9750-a9aef103669d', 'MÜTALAALIK ORTAOKUL') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('dcd824e5-36a8-4c7e-8157-545f24d76c83', 'WUSTHO') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('a50fbc33-29f2-4da6-9339-eeeb0dc298a7', 'ULYA') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('ad6779be-9e7d-45fc-9cb1-70792c0435a3', 'MUKHTASAR') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('5cfad115-2eff-4655-b49e-76ce1cbee1ae', 'ISTIDAD') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('401f3aca-e1ad-4c81-a9e2-2daaeef15178', 'ALAMAT') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('a6a7bbaf-c60e-4506-a9ad-904c28c15966', 'I''DAD') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('ce2e0ef3-fd3f-49eb-95d8-a4b8edb6827e', 'ULA / AWWALIYAH') ON CONFLICT ("name") DO NOTHING;
INSERT INTO "pesantren"."jenis_grup_daimi" ("id", "name") VALUES ('1f9319d4-d489-48ff-aa4d-8ca049a7435c', 'DINIYAH') ON CONFLICT ("name") DO NOTHING;
