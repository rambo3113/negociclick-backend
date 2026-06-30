-- CreateTable
CREATE TABLE "featured_payments" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "culqiChargeId" TEXT NOT NULL,
    "featuredUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "featured_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "featured_payments_businessId_idx" ON "featured_payments"("businessId");

-- CreateIndex
CREATE INDEX "featured_payments_userId_idx" ON "featured_payments"("userId");

-- CreateIndex
CREATE INDEX "featured_payments_createdAt_idx" ON "featured_payments"("createdAt");

-- AddForeignKey
ALTER TABLE "featured_payments" ADD CONSTRAINT "featured_payments_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "featured_payments" ADD CONSTRAINT "featured_payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
