CREATE TABLE "ChainSnapshot" (
  "scope" VARCHAR(100) NOT NULL,
  "height" BIGINT NOT NULL,
  "hash" CHAR(66) NOT NULL,
  "ordersHash" CHAR(64) NOT NULL,
  "stocksHash" CHAR(64) NOT NULL,
  "globals" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("scope","height"),
  FOREIGN KEY ("scope","hash") REFERENCES "ChainBlock"("scope","hash") ON DELETE RESTRICT
);
