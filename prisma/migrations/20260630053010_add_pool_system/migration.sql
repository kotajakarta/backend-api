-- CreateEnum
CREATE TYPE "core"."StatusPool" AS ENUM ('TERSEDIA', 'AKTIF_CABANG', 'LULUS', 'MUTASI', 'DROP_OUT');

-- DropForeignKey
ALTER TABLE "core"."students" DROP CONSTRAINT "students_cabang_id_fkey";

-- AlterTable
ALTER TABLE "core"."students" ADD COLUMN     "status_pool" "core"."StatusPool" NOT NULL DEFAULT 'TERSEDIA',
ALTER COLUMN "cabang_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "core"."riwayat_pendidikan" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "cabang_id" TEXT NOT NULL,
    "tanggal_masuk" TIMESTAMP(3) NOT NULL,
    "tanggal_keluar" TIMESTAMP(3),
    "status_akhir" TEXT,
    "catatan" TEXT,

    CONSTRAINT "riwayat_pendidikan_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "core"."students" ADD CONSTRAINT "students_cabang_id_fkey" FOREIGN KEY ("cabang_id") REFERENCES "core"."cabang"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."riwayat_pendidikan" ADD CONSTRAINT "riwayat_pendidikan_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."riwayat_pendidikan" ADD CONSTRAINT "riwayat_pendidikan_cabang_id_fkey" FOREIGN KEY ("cabang_id") REFERENCES "core"."cabang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
