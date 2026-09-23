-- CreateEnum
CREATE TYPE "core"."StatusPelanggaran" AS ENUM ('PENDING', 'DISETUJUI', 'DITOLAK');

-- AlterTable
ALTER TABLE "core"."pelanggaran_santri" ADD COLUMN "status" "core"."StatusPelanggaran" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "core"."pelanggaran_santri" ADD COLUMN "approved_by" TEXT;
ALTER TABLE "core"."pelanggaran_santri" ADD COLUMN "approved_at" TIMESTAMP(3);

-- Update existing records to DISETUJUI so past records remain active and valid
UPDATE "core"."pelanggaran_santri" SET "status" = 'DISETUJUI', "approved_by" = 'SISTEM', "approved_at" = NOW() WHERE "status" = 'PENDING';
