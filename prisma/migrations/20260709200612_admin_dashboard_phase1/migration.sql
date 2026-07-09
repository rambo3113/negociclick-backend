-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "reportedByUserId" TEXT NOT NULL,
    "reportedBusinessId" TEXT,
    "reportedServiceId" TEXT,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "reports_reportedByUserId_idx" ON "reports"("reportedByUserId");

-- CreateIndex
CREATE INDEX "reports_reportedBusinessId_idx" ON "reports"("reportedBusinessId");

-- CreateIndex
CREATE INDEX "businesses_status_idx" ON "businesses"("status");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reportedBusinessId_fkey" FOREIGN KEY ("reportedBusinessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reportedServiceId_fkey" FOREIGN KEY ("reportedServiceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
