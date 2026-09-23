-- CreateEnum safely
DO $$ BEGIN
    CREATE TYPE "core"."StatusPelanggaran" AS ENUM ('PENDING', 'DISETUJUI', 'DITOLAK');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "core"."pelanggaran_santri" ADD COLUMN IF NOT EXISTS "status" "core"."StatusPelanggaran" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "core"."pelanggaran_santri" ADD COLUMN IF NOT EXISTS "approved_by" TEXT;
ALTER TABLE "core"."pelanggaran_santri" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3);

-- Update existing records to DISETUJUI so past records remain active and valid
UPDATE "core"."pelanggaran_santri" SET "status" = 'DISETUJUI', "approved_by" = 'SISTEM', "approved_at" = NOW() WHERE "status" = 'PENDING';
