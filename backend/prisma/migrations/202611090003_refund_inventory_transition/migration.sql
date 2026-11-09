CREATE TABLE "RefundInventoryTransition" (
 "scope" varchar(100) NOT NULL, "chainOrderId" char(66) NOT NULL,
 "orderId" uuid NOT NULL REFERENCES "Order"("id"), "stockId" char(66) NOT NULL,
 "generation" varchar(78) NOT NULL, "nextGeneration" varchar(78) NOT NULL,
 "basisHash" char(64) NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY ("scope","chainOrderId"), UNIQUE("scope","stockId","generation"),
 CHECK ("generation" ~ '^(0|[1-9][0-9]{0,77})$' AND "nextGeneration" ~ '^[1-9][0-9]{0,77}$'),
 CHECK ("nextGeneration"::numeric="generation"::numeric+1)
);
