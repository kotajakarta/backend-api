-- CreateEnum
CREATE TYPE "core"."KategoriPelanggaran" AS ENUM ('RINGAN', 'SEDANG', 'BERAT');

-- CreateEnum
CREATE TYPE "core"."TingkatSp" AS ENUM ('SP_1', 'SP_2', 'SP_3');

-- CreateEnum
CREATE TYPE "core"."StatusSp" AS ENUM ('AKTIF', 'MASA_PEMBINAAN', 'SELESAI', 'DITINGKATKAN', 'SIDANG_DISIPLIN');

-- CreateEnum
CREATE TYPE "core"."KategoriPengeluaran" AS ENUM ('AKUMULASI_POIN', 'PELANGGARAN_BERAT', 'MANGKIR_KABUR', 'KRIMINAL_NARKOBA', 'LAINNYA');

-- CreateTable
CREATE TABLE "core"."pelanggaran_santri" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "wilayah_id" TEXT,
    "cabang_id" TEXT,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "jenis_pelanggaran" TEXT NOT NULL,
    "kategori" "core"."KategoriPelanggaran" NOT NULL DEFAULT 'RINGAN',
    "poin" INTEGER NOT NULL DEFAULT 5,
    "lokasi" TEXT,
    "keterangan" TEXT,
    "tindakan_pembinaan" TEXT,
    "dicatat_oleh" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pelanggaran_santri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."surat_peringatan" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "wilayah_id" TEXT,
    "cabang_id" TEXT,
    "nomor_sp" TEXT NOT NULL,
    "tingkat_sp" "core"."TingkatSp" NOT NULL DEFAULT 'SP_1',
    "status" "core"."StatusSp" NOT NULL DEFAULT 'AKTIF',
    "tanggal_terbit" TIMESTAMP(3) NOT NULL,
    "berlaku_hingga" TIMESTAMP(3),
    "poin_akumulasi" INTEGER NOT NULL DEFAULT 0,
    "alasan" TEXT NOT NULL,
    "tembusan" TEXT,
    "dokumen_sp_url" TEXT,
    "ukuran_dokumen" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surat_peringatan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."pengeluaran_santri" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "wilayah_id" TEXT,
    "cabang_id" TEXT,
    "tanggal_keluar" TIMESTAMP(3) NOT NULL,
    "alasan_pemberhentian" TEXT NOT NULL,
    "kategori_alasan" "core"."KategoriPengeluaran" NOT NULL DEFAULT 'AKUMULASI_POIN',
    "nomor_sk" TEXT NOT NULL,
    "tanggal_sk" TIMESTAMP(3) NOT NULL,
    "dokumen_sk_url" TEXT,
    "ukuran_dokumen" TEXT,
    "pejabat_ttd" TEXT NOT NULL,
    "keterangan_tambahan" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pengeluaran_santri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "surat_peringatan_nomor_sp_key" ON "core"."surat_peringatan"("nomor_sp");

-- CreateIndex
CREATE UNIQUE INDEX "pengeluaran_santri_student_id_key" ON "core"."pengeluaran_santri"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "pengeluaran_santri_nomor_sk_key" ON "core"."pengeluaran_santri"("nomor_sk");

-- AddForeignKey
ALTER TABLE "core"."pelanggaran_santri" ADD CONSTRAINT "pelanggaran_santri_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."surat_peringatan" ADD CONSTRAINT "surat_peringatan_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."pengeluaran_santri" ADD CONSTRAINT "pengeluaran_santri_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
