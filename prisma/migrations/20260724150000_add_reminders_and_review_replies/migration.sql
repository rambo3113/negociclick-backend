-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "remindersEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "vendorRepliedAt" TIMESTAMP(3),
ADD COLUMN     "vendorReply" TEXT;

-- CreateTable
CREATE TABLE "reminder_logs" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "status" TEXT NOT NULL,
    "errorMsg" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bookingId" TEXT NOT NULL,

    CONSTRAINT "reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reminder_logs_bookingId_idx" ON "reminder_logs"("bookingId");

-- CreateIndex
CREATE INDEX "reminder_logs_sentAt_idx" ON "reminder_logs"("sentAt");

-- AddForeignKey
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
