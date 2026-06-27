-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "culqiChargeId" TEXT;

-- CreateIndex
CREATE INDEX "subscriptions_endDate_idx" ON "subscriptions"("endDate");
