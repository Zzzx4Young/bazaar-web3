CREATE OR REPLACE FUNCTION protect_media_asset_history() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('ready', 'cold_only') THEN
    IF NEW."id" IS DISTINCT FROM OLD."id" OR
       NEW."sellerId" IS DISTINCT FROM OLD."sellerId" OR
       NEW."uploadKey" IS DISTINCT FROM OLD."uploadKey" OR
       NEW."contentType" IS DISTINCT FROM OLD."contentType" OR
       NEW."declaredBytes" IS DISTINCT FROM OLD."declaredBytes" OR
       NEW."actualBytes" IS DISTINCT FROM OLD."actualBytes" OR
       NEW."sha256" IS DISTINCT FROM OLD."sha256" OR
       NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR
       NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt" OR
       (OLD."coldKey" IS NOT NULL AND NEW."coldKey" IS DISTINCT FROM OLD."coldKey") OR
       (OLD."hotKey" IS NOT NULL AND NEW."hotKey" IS DISTINCT FROM OLD."hotKey" AND
         NOT (OLD."status" = 'ready' AND NEW."status" = 'cold_only' AND NEW."hotKey" IS NULL)) OR
       (OLD."status" = 'cold_only' AND NEW."status" <> 'cold_only') OR
       (OLD."status" = 'ready' AND NEW."status" NOT IN ('ready', 'cold_only')) THEN
      RAISE EXCEPTION 'immutable media asset' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER media_asset_history_immutable
  BEFORE UPDATE ON "MediaAsset"
  FOR EACH ROW EXECUTE FUNCTION protect_media_asset_history();

CREATE OR REPLACE FUNCTION protect_order_media_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'immutable order media history' USING ERRCODE = '23514';
  END IF;
  IF NEW."orderId" IS DISTINCT FROM OLD."orderId" OR
     NEW."mediaId" IS DISTINCT FROM OLD."mediaId" OR
     NEW."position" IS DISTINCT FROM OLD."position" OR
     (OLD."storageTier" = 'cold' AND
       (NEW."storageTier" <> 'cold' OR NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt")) OR
     (OLD."storageTier" = 'hot' AND NEW."storageTier" NOT IN ('hot', 'cold')) THEN
    RAISE EXCEPTION 'immutable order media history' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_media_history_immutable
  BEFORE UPDATE OR DELETE ON "OrderMediaSnapshot"
  FOR EACH ROW EXECUTE FUNCTION protect_order_media_history();
