-- Add timestamp fields to bookings
ALTER TABLE "bookings" ADD COLUMN "paymentConfirmedAt" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- Create booking_timeline table
CREATE TABLE "booking_timeline" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "description" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bookingId" TEXT NOT NULL,

    CONSTRAINT "booking_timeline_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX "booking_timeline_bookingId_idx" ON "booking_timeline"("bookingId");
CREATE INDEX "booking_timeline_bookingId_timestamp_idx" ON "booking_timeline"("bookingId", "timestamp");

-- Add foreign key
ALTER TABLE "booking_timeline" ADD CONSTRAINT "booking_timeline_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
