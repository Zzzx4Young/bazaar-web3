BEGIN;
-- Compatible V2 migration exercise: existing history stays immutable and unchanged.
ALTER TABLE "OrderEvent" ADD COLUMN "note" TEXT;
COMMIT;
