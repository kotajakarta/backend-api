-- Lets a cabang declare it cannot carry out an activity (and so cannot submit a real BAP),
-- with a reason, instead of leaving the activity permanently "Belum Dilaporkan".
ALTER TABLE "core"."kegiatan" ADD COLUMN "tidak_bisa_bap" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "core"."kegiatan" ADD COLUMN "alasan_tidak_bisa_bap" TEXT;
ALTER TABLE "core"."kegiatan" ADD COLUMN "tidak_bisa_bap_at" TIMESTAMP(3);
