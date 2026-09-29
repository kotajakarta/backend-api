-- Menambahkan index yang hilang pada kolom foreign key/filter yang sering
-- dipakai di endpoint dashboard, laporan, dan kontrol silabus. Tanpa index ini,
-- Postgres melakukan sequential scan pada setiap query — terkonfirmasi lewat
-- pg_stat_user_tables di produksi (ratusan ribu seq_scan pada tabel-tabel ini).

-- CreateIndex
CREATE INDEX "riwayat_pendidikan_student_id_idx" ON "core"."riwayat_pendidikan"("student_id");

-- CreateIndex
CREATE INDEX "staff_cabang_id_status_pool_idx" ON "core"."staff"("cabang_id", "status_pool");

-- CreateIndex
CREATE INDEX "students_cabang_id_is_active_idx" ON "core"."students"("cabang_id", "is_active");

-- CreateIndex
CREATE INDEX "students_wilayah_id_idx" ON "core"."students"("wilayah_id");

-- CreateIndex
CREATE INDEX "kelas_cabang_id_is_active_idx" ON "formal"."kelas"("cabang_id", "is_active");

-- CreateIndex
CREATE INDEX "siswa_formal_kelas_id_idx" ON "formal"."siswa_formal"("kelas_id");
