-- CreateEnum
CREATE TYPE "core"."StatusHafidz" AS ENUM ('BELUM_MULAI', 'SEDANG_BERLANGSUNG', 'SUDAH_SETOR_30_JUZ', 'SUDAH_KHATAMAN_KUBRO');

-- AlterTable
ALTER TABLE "core"."students" ADD COLUMN     "status_hafidz" "core"."StatusHafidz";

-- AlterTable
ALTER TABLE "formal"."riwayat_kelas_formal" DROP COLUMN "sikap_sosial",
DROP COLUMN "sikap_spiritual",
ADD COLUMN     "disiplin" TEXT,
ADD COLUMN     "hubungan_sosial" TEXT,
ADD COLUMN     "kemampuan_representasi" TEXT,
ADD COLUMN     "kepercayaan_diri" TEXT,
ADD COLUMN     "kerapihan" TEXT,
ADD COLUMN     "ketaatan" TEXT,
ADD COLUMN     "ketakwaan" TEXT,
ADD COLUMN     "semangat_belajar" TEXT,
ADD COLUMN     "tanggung_jawab" TEXT;

-- CreateTable
CREATE TABLE "formal"."hafalan_al_quran" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "kelas_id" TEXT NOT NULL,
    "tahun_ajaran" TEXT NOT NULL,
    "semester" TEXT NOT NULL,
    "awal_putaran" INTEGER,
    "awal_juz" INTEGER,
    "target_putaran" INTEGER,
    "target_juz" INTEGER,
    "akhir_putaran" INTEGER,
    "akhir_juz" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hafalan_al_quran_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hafalan_al_quran_student_id_tahun_ajaran_semester_key" ON "formal"."hafalan_al_quran"("student_id", "tahun_ajaran", "semester");

-- AddForeignKey
ALTER TABLE "formal"."hafalan_al_quran" ADD CONSTRAINT "hafalan_al_quran_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formal"."hafalan_al_quran" ADD CONSTRAINT "hafalan_al_quran_kelas_id_fkey" FOREIGN KEY ("kelas_id") REFERENCES "formal"."kelas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
