-- Non-MVCC activation fence: a waiting RepeatableRead legacy transaction must
-- observe enrollment even when its earlier snapshot predates the outbox insert.
-- Only the independent owner may advance it. Rollback deliberately does not clear it.
CREATE SEQUENCE "LedgerPublicationFence" AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE CACHE 1;
REVOKE ALL ON SEQUENCE "LedgerPublicationFence" FROM PUBLIC;
