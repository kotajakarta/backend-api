-- Baseline migration: brings the three dashboard "rekap" (aggregation) tables
-- under tracked migration history. These tables were previously created via
-- `prisma db push` and existed only in the live database, not in migration
-- history. This migration is marked as already-applied on existing databases
-- (via `prisma migrate resolve --applied`) and will create the tables for
-- real on any fresh database that runs `prisma migrate deploy`.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "core";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "formal";

-- CreateTable
CREATE TABLE "core"."rekap_dashboard_utama" (
    "id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "total_santri" INTEGER NOT NULL DEFAULT 0,
    "total_santri_formal" INTEGER NOT NULL DEFAULT 0,
    "total_non_muadalah" INTEGER NOT NULL DEFAULT 0,
    "total_kelas" INTEGER NOT NULL DEFAULT 0,
    "chart_grup_daimi" JSONB NOT NULL,
    "chart_statistik_tingkat" JSONB NOT NULL,
    "ketersediaan_guru" JSONB NOT NULL,
    "kelengkapan_santri" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rekap_dashboard_utama_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."rekap_kegiatan" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL DEFAULT 'ALL',
    "group_type" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "parent_group_id" TEXT,
    "total_cabang" INTEGER NOT NULL DEFAULT 0,
    "active_cabang_count" INTEGER NOT NULL DEFAULT 0,
    "total_bap_submitted" INTEGER NOT NULL DEFAULT 0,
    "total_bap_confirmed" INTEGER NOT NULL DEFAULT 0,
    "total_bap_pending" INTEGER NOT NULL DEFAULT 0,
    "total_santri" INTEGER NOT NULL DEFAULT 0,
    "total_guru" INTEGER NOT NULL DEFAULT 0,
    "total_peserta" INTEGER NOT NULL DEFAULT 0,
    "completion_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'BELUM_ADA',
    "extra_data" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rekap_kegiatan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formal"."rekap_pembelajaran" (
    "id" TEXT NOT NULL,
    "tahun_ajaran" TEXT NOT NULL,
    "semester" TEXT NOT NULL,
    "periode_tipe" TEXT NOT NULL,
    "periode_key" TEXT NOT NULL,
    "unit_level" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "unit_name" TEXT NOT NULL,
    "parent_name" TEXT,
    "mata_pelajaran_id" TEXT NOT NULL DEFAULT 'ALL',
    "jumlah_cabang" INTEGER NOT NULL DEFAULT 0,
    "jumlah_kelas" INTEGER NOT NULL DEFAULT 0,
    "jumlah_siswa" INTEGER NOT NULL DEFAULT 0,
    "mapel_terlaksana" INTEGER NOT NULL DEFAULT 0,
    "mapel_target" INTEGER NOT NULL DEFAULT 0,
    "persen_mapel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_hadir" INTEGER NOT NULL DEFAULT 0,
    "total_absensi" INTEGER NOT NULL DEFAULT 0,
    "persen_kehadiran" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weeks_json" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rekap_pembelajaran_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rekap_dashboard_utama_scope_key_key" ON "core"."rekap_dashboard_utama"("scope_key");

-- CreateIndex
CREATE INDEX "rekap_kegiatan_group_type_group_id_idx" ON "core"."rekap_kegiatan"("group_type", "group_id");

-- CreateIndex
CREATE INDEX "rekap_kegiatan_template_id_idx" ON "core"."rekap_kegiatan"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "rekap_kegiatan_template_id_group_type_group_id_key" ON "core"."rekap_kegiatan"("template_id", "group_type", "group_id");

-- CreateIndex
CREATE INDEX "rekap_pembelajaran_tahun_ajaran_semester_periode_tipe_perio_idx" ON "formal"."rekap_pembelajaran"("tahun_ajaran", "semester", "periode_tipe", "periode_key");

-- CreateIndex
CREATE INDEX "rekap_pembelajaran_unit_level_unit_id_idx" ON "formal"."rekap_pembelajaran"("unit_level", "unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "rekap_pembelajaran_tahun_ajaran_semester_periode_tipe_perio_key" ON "formal"."rekap_pembelajaran"("tahun_ajaran", "semester", "periode_tipe", "periode_key", "unit_level", "unit_id", "mata_pelajaran_id");
