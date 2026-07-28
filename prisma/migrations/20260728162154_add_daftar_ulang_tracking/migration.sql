-- AlterTable
ALTER TABLE "core"."students" ADD COLUMN     "daftar_ulang_at" TIMESTAMP(3),
ADD COLUMN     "daftar_ulang_jenis" TEXT,
ADD COLUMN     "daftar_ulang_tahun_ajaran" TEXT,
ADD COLUMN     "daftar_ulang_semester" TEXT;
