-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "absensi";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "core";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "formal";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "pesantren";

-- CreateEnum
CREATE TYPE "core"."UserScope" AS ENUM ('GLOBAL', 'WILAYAH', 'CABANG');

-- CreateEnum
CREATE TYPE "core"."UserDivisi" AS ENUM ('FORMAL', 'PESANTREN', 'ALL');

-- CreateTable
CREATE TABLE "core"."wilayah" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "wilayah_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."cabang" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "wilayah_id" TEXT NOT NULL,

    CONSTRAINT "cabang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "scope" "core"."UserScope" NOT NULL,
    "divisi" "core"."UserDivisi" NOT NULL,
    "wilayah_id" TEXT,
    "cabang_id" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."biodata" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,

    CONSTRAINT "biodata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."students" (
    "id" TEXT NOT NULL,
    "biodata_id" TEXT NOT NULL,
    "wilayah_id" TEXT NOT NULL,
    "cabang_id" TEXT NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."staff" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formal"."kelas" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "kelas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formal"."mata_pelajaran" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "mata_pelajaran_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formal"."nilai_formal" (
    "id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "nilai_formal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pesantren"."kamar" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "kamar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pesantren"."tahfidz_progress" (
    "id" TEXT NOT NULL,
    "surah" TEXT NOT NULL,
    "progress" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "tahfidz_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pesantren"."nilai_kitab" (
    "id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "nilai_kitab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absensi"."tipe_kegiatan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "tipe_kegiatan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absensi"."log_kehadiran" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_kehadiran_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "core"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "students_biodata_id_key" ON "core"."students"("biodata_id");

-- AddForeignKey
ALTER TABLE "core"."cabang" ADD CONSTRAINT "cabang_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "core"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."users" ADD CONSTRAINT "users_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "core"."wilayah"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."users" ADD CONSTRAINT "users_cabang_id_fkey" FOREIGN KEY ("cabang_id") REFERENCES "core"."cabang"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."students" ADD CONSTRAINT "students_biodata_id_fkey" FOREIGN KEY ("biodata_id") REFERENCES "core"."biodata"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."students" ADD CONSTRAINT "students_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "core"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."students" ADD CONSTRAINT "students_cabang_id_fkey" FOREIGN KEY ("cabang_id") REFERENCES "core"."cabang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absensi"."log_kehadiran" ADD CONSTRAINT "log_kehadiran_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "core"."students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
