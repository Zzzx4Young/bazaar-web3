ALTER TABLE "OrderEvent" ALTER COLUMN "actorId" DROP NOT NULL;

ALTER TABLE "OrderEvent" ADD CONSTRAINT "order_event_actor_valid" CHECK (
  "actorId" IS NOT NULL OR "operation" = 'expire'
);
