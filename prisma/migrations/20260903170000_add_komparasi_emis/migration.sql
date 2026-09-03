-- CreateTable
CREATE TABLE "formal"."komparasi_emis_batch" (
    "id" TEXT NOT NULL,
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executed_by_id" TEXT,
    "total_santri_esantri" INTEGER NOT NULL DEFAULT 0,
    "total_terdaftar_emis" INTEGER NOT NULL DEFAULT 0,
    "total_belum_emis" INTEGER NOT NULL DEFAULT 0,
    "total_verval_ok" INTEGER NOT NULL DEFAULT 0,
    "total_residu_verval" INTEGER NOT NULL DEFAULT 0,
    "total_belum_verval" INTEGER NOT NULL DEFAULT 0,
    "total_diskrepansi" INTEGER NOT NULL DEFAULT 0,
    "total_butuh_tindakan" INTEGER NOT NULL DEFAULT 0,
    "cabang_breakdown" JSONB NOT NULL,
    "catatan" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "komparasi_emis_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formal"."komparasi_emis" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "student_id" TEXT,
    "nama" TEXT NOT NULL,
    "cabang_id" TEXT,
    "cabang_name" TEXT,
    "wilayah_name" TEXT,
    "lembaga_muadalah_name" TEXT,
    "tingkat" TEXT,
    "kelas_name" TEXT,
    "nisn_esantri" TEXT,
    "nik_esantri" TEXT,
    "tempat_lahir_esantri" TEXT,
    "tanggal_lahir_esantri" TEXT,
    "jenis_kelamin_esantri" TEXT,
    "status_emis" TEXT NOT NULL,
    "emis_id" TEXT,
    "nisn_emis" TEXT,
    "rombel_emis" TEXT,
    "source_lembaga_emis" TEXT,
    "status_verval" TEXT NOT NULL,
    "verval_pd_id" TEXT,
    "nisn_verval" TEXT,
    "residu_detail" JSONB,
    "butuh_tindakan" BOOLEAN NOT NULL DEFAULT false,
    "discrepancies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rekomendasi_tindakan" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "komparasi_emis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "komparasi_emis_batch_id_idx" ON "formal"."komparasi_emis"("batch_id");

-- CreateIndex
CREATE INDEX "komparasi_emis_cabang_id_idx" ON "formal"."komparasi_emis"("cabang_id");

-- CreateIndex
CREATE INDEX "komparasi_emis_status_emis_idx" ON "formal"."komparasi_emis"("status_emis");

-- CreateIndex
CREATE INDEX "komparasi_emis_status_verval_idx" ON "formal"."komparasi_emis"("status_verval");

-- CreateIndex
CREATE INDEX "komparasi_emis_butuh_tindakan_idx" ON "formal"."komparasi_emis"("butuh_tindakan");

-- AddForeignKey
ALTER TABLE "formal"."komparasi_emis" ADD CONSTRAINT "komparasi_emis_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "formal"."komparasi_emis_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formal"."komparasi_emis" ADD CONSTRAINT "komparasi_emis_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE SET NULL ON UPDATE CASCADE;
