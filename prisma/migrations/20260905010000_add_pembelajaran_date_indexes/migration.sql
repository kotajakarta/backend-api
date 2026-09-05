-- Speeds up the (kelasId IN (...) AND date range) queries used by
-- PembelajaranRekapService.syncPeriod, which previously fell back to a
-- sequential scan of absensi_mapel / pelaksanaan_silabus (100k+ rows) since
-- kelasId was not the leading column of either table's existing unique
-- index. CONCURRENTLY avoids locking these actively-queried, live tables
-- while the index builds.
-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "absensi_mapel_kelas_id_tanggal_idx" ON "formal"."absensi_mapel"("kelas_id", "tanggal");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "pelaksanaan_silabus_kelas_id_tanggal_diajar_idx" ON "formal"."pelaksanaan_silabus"("kelas_id", "tanggal_diajar");
