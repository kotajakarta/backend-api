-- AlterTable surat_peringatan
ALTER TABLE "core"."surat_peringatan" ADD COLUMN "status_approval" "core"."StatusPelanggaran" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "core"."surat_peringatan" ADD COLUMN "approved_by" TEXT;
ALTER TABLE "core"."surat_peringatan" ADD COLUMN "approved_at" TIMESTAMP(3);

-- Update existing SP records to DISETUJUI so past records remain active and valid
UPDATE "core"."surat_peringatan" SET "status_approval" = 'DISETUJUI', "approved_by" = 'SISTEM', "approved_at" = NOW() WHERE "status_approval" = 'PENDING';

-- AlterTable pengeluaran_santri
ALTER TABLE "core"."pengeluaran_santri" ADD COLUMN "status" "core"."StatusPelanggaran" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "core"."pengeluaran_santri" ADD COLUMN "approved_by" TEXT;
ALTER TABLE "core"."pengeluaran_santri" ADD COLUMN "approved_at" TIMESTAMP(3);

-- Update existing Pengeluaran records to DISETUJUI so past records remain valid
UPDATE "core"."pengeluaran_santri" SET "status" = 'DISETUJUI', "approved_by" = 'SISTEM', "approved_at" = NOW() WHERE "status" = 'PENDING';
