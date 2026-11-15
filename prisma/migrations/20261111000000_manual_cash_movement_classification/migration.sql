-- Historical movements deliberately remain unclassified. No default or backfill.
CREATE TYPE "CashMovementClassification" AS ENUM ('EXTERNAL_CAPITAL', 'INCOME', 'EXPENSE');

ALTER TABLE "CashEvent" ADD COLUMN "economicClassification" "CashMovementClassification";

ALTER TABLE "CashEvent" ADD CONSTRAINT "CashEvent_economicClassification_check" CHECK (
  "economicClassification" IS NULL OR (
    "type" = 'MOVEMENT'
    AND "orderId" IS NULL
    AND "transferId" IS NULL
    AND "transferCounterpartyAccountId" IS NULL
    AND "transferCounterpartyMode" IS NULL
    AND "transferCounterpartyAmount" IS NULL
    AND "transferCounterpartyCurrency" IS NULL
  )
);
