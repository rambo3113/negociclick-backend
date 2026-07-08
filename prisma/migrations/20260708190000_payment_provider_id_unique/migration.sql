-- DropIndex
DROP INDEX IF EXISTS "payments_providerId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerId_key" ON "payments"("providerId");
