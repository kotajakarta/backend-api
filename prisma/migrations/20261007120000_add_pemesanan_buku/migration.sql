-- CreateEnum
CREATE TYPE "formal"."StatusPemesananCabang" AS ENUM ('DRAFT_CABANG', 'SUBMITTED_CABANG');

-- CreateEnum
CREATE TYPE "formal"."StatusPemesananWilayah" AS ENUM ('DRAFT_WILAYAH', 'SUBMITTED_WILAYAH');

-- CreateTable
CREATE TABLE "formal"."sesi_pemesanan_buku" (
    "id" TEXT NOT NULL,
    "tahun_ajaran" TEXT NOT NULL,
    "semester" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "is_open" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sesi_pemesanan_buku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formal"."pemesanan_buku_cabang" (
    "id" TEXT NOT NULL,
    "sesi_id" TEXT NOT NULL,
    "cabang_id" TEXT NOT NULL,
    "wilayah_id" TEXT NOT NULL,
    "status" "formal"."StatusPemesananCabang" NOT NULL,
    "nomor" TEXT NOT NULL,
    "draft_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "submitted_by_id" TEXT,
    "submitted_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pemesanan_buku_cabang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formal"."pemesanan_buku_cabang_item" (
    "id" TEXT NOT NULL,
    "pesanan_id" TEXT NOT NULL,
    "tingkat" INTEGER NOT NULL,
    "jumlah_santri" INTEGER NOT NULL,
    "jumlah_guru" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,

    CONSTRAINT "pemesanan_buku_cabang_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formal"."pemesanan_buku_wilayah" (
    "id" TEXT NOT NULL,
    "sesi_id" TEXT NOT NULL,
    "wilayah_id" TEXT NOT NULL,
    "status" "formal"."StatusPemesananWilayah" NOT NULL,
    "nomor" TEXT NOT NULL,
    "ttd_file_key" TEXT,
    "ttd_file_name" TEXT,
    "ttd_mime" TEXT,
    "ttd_uploaded_at" TIMESTAMP(3),
    "draft_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "submitted_by_id" TEXT,
    "submitted_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pemesanan_buku_wilayah_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sesi_pemesanan_buku_tahun_ajaran_semester_key" ON "formal"."sesi_pemesanan_buku"("tahun_ajaran", "semester");

-- CreateIndex
CREATE UNIQUE INDEX "pemesanan_buku_cabang_nomor_key" ON "formal"."pemesanan_buku_cabang"("nomor");

-- CreateIndex
CREATE INDEX "pemesanan_buku_cabang_sesi_id_wilayah_id_idx" ON "formal"."pemesanan_buku_cabang"("sesi_id", "wilayah_id");

-- CreateIndex
CREATE UNIQUE INDEX "pemesanan_buku_cabang_sesi_id_cabang_id_key" ON "formal"."pemesanan_buku_cabang"("sesi_id", "cabang_id");

-- CreateIndex
CREATE UNIQUE INDEX "pemesanan_buku_cabang_item_pesanan_id_tingkat_key" ON "formal"."pemesanan_buku_cabang_item"("pesanan_id", "tingkat");

-- CreateIndex
CREATE UNIQUE INDEX "pemesanan_buku_wilayah_nomor_key" ON "formal"."pemesanan_buku_wilayah"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "pemesanan_buku_wilayah_sesi_id_wilayah_id_key" ON "formal"."pemesanan_buku_wilayah"("sesi_id", "wilayah_id");

-- AddForeignKey
ALTER TABLE "formal"."pemesanan_buku_cabang" ADD CONSTRAINT "pemesanan_buku_cabang_sesi_id_fkey" FOREIGN KEY ("sesi_id") REFERENCES "formal"."sesi_pemesanan_buku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formal"."pemesanan_buku_cabang" ADD CONSTRAINT "pemesanan_buku_cabang_cabang_id_fkey" FOREIGN KEY ("cabang_id") REFERENCES "core"."cabang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formal"."pemesanan_buku_cabang" ADD CONSTRAINT "pemesanan_buku_cabang_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "core"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formal"."pemesanan_buku_cabang_item" ADD CONSTRAINT "pemesanan_buku_cabang_item_pesanan_id_fkey" FOREIGN KEY ("pesanan_id") REFERENCES "formal"."pemesanan_buku_cabang"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formal"."pemesanan_buku_wilayah" ADD CONSTRAINT "pemesanan_buku_wilayah_sesi_id_fkey" FOREIGN KEY ("sesi_id") REFERENCES "formal"."sesi_pemesanan_buku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formal"."pemesanan_buku_wilayah" ADD CONSTRAINT "pemesanan_buku_wilayah_wilayah_id_fkey" FOREIGN KEY ("wilayah_id") REFERENCES "core"."wilayah"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
