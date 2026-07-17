-- AddColumn delivery fields to bookings
ALTER TABLE "bookings" ADD COLUMN "deliveryMethod" TEXT;
ALTER TABLE "bookings" ADD COLUMN "deliveryZoneName" TEXT;
ALTER TABLE "bookings" ADD COLUMN "deliveryCost" DECIMAL(10,2);
ALTER TABLE "bookings" ADD COLUMN "deliveryStatus" TEXT;

-- CreateIndex
CREATE INDEX "bookings_deliveryMethod_idx" ON "bookings"("deliveryMethod");
CREATE INDEX "bookings_deliveryStatus_idx" ON "bookings"("deliveryStatus");
