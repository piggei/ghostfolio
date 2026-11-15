-- Indexes supporting daily cash classification reader queries.
CREATE INDEX "CashEvent_userId_date_idx"
ON "CashEvent"("userId", "date");

CREATE INDEX "CashEvent_userId_transferId_idx"
ON "CashEvent"("userId", "transferId");
