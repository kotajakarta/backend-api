-- Links each Lembaga Muadalah to a Wilayah so the institution list can be
-- filtered/grouped by region, matching how Cabang already relates to Wilayah.
ALTER TABLE "formal"."lembaga_muadalah" ADD COLUMN "wilayah_id" TEXT;

ALTER TABLE "formal"."lembaga_muadalah"
  ADD CONSTRAINT "lembaga_muadalah_wilayah_id_fkey"
  FOREIGN KEY ("wilayah_id") REFERENCES "core"."wilayah"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "lembaga_muadalah_wilayah_id_idx" ON "formal"."lembaga_muadalah"("wilayah_id");
