ALTER TABLE "Account" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'participant';
ALTER TABLE "Account" ADD CONSTRAINT "account_role_valid" CHECK (
  "role" IN ('participant', 'admin', 'observer')
);

ALTER TABLE "RefundRequest" ADD COLUMN "resolvedBy" UUID;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_resolvedBy_fkey"
  FOREIGN KEY ("resolvedBy") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "RefundRequest" DROP CONSTRAINT "refund_valid";
ALTER TABLE "RefundRequest" ADD CONSTRAINT "refund_valid" CHECK (
  ("status" = 'pending' AND "approvedBy" IS NULL AND "resolvedBy" IS NULL
    AND "approvedAt" IS NULL AND "returnOutcome" IS NULL) OR
  ("status" = 'approved' AND num_nonnulls("approvedBy", "resolvedBy") = 1
    AND "approvedAt" IS NOT NULL AND "returnOutcome" IS NOT NULL AND "returnOutcome" IN
    ('not_sent', 'returned', 'not_required', 'digital')) OR
  ("status" = 'closed' AND "approvedBy" IS NULL AND "resolvedBy" IS NULL
    AND "approvedAt" IS NULL AND "returnOutcome" IS NULL)
);

ALTER TABLE "SettlementRecord" DROP CONSTRAINT "settlement_valid";
ALTER TABLE "SettlementRecord" ADD CONSTRAINT "settlement_valid" CHECK (
  "mode" = 'simulated' AND "operation" IN ('payment', 'refund', 'release') AND "amount" > 0
);

-- Completed orders predating release records must contribute to seller balances.
-- Only paid orders are eligible; anomalous unpaid completions require manual review.
INSERT INTO "SettlementRecord" ("id", "orderId", "operation", "amount", "currency")
SELECT gen_random_uuid(), o."id", 'release', s."priceAmount", s."currency"
FROM "Order" o
JOIN "OrderSnapshot" s ON s."orderId" = o."id"
JOIN "SettlementRecord" payment ON payment."orderId" = o."id"
  AND payment."operation" = 'payment'
WHERE o."status" = 'completed' AND s."priceAmount" > 0
ON CONFLICT ("orderId", "operation") DO NOTHING;

CREATE UNIQUE INDEX "one_dispute_counteroffer" ON "OrderEvent" ("orderId")
  WHERE "operation" = 'counteroffer';
