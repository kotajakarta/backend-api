-- Stores the muadalah-only student count alongside the existing all-students count,
-- since EMIS/VervalPD reconciliation only ever applies to muadalah (tingkat 7-12) santri.
ALTER TABLE "formal"."komparasi_emis_batch" ADD COLUMN "total_santri_muadalah" INTEGER NOT NULL DEFAULT 0;
