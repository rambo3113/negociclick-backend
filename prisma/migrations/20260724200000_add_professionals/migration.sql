-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "professionalId" TEXT;

-- CreateTable
CREATE TABLE "professionals" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "photo" TEXT,
    "specialties" JSONB NOT NULL DEFAULT '[]',
    "bio" TEXT,
    "averageRating" DOUBLE PRECISION,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "professionals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_schedules" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "professional_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "professionals_businessId_idx" ON "professionals"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "professional_schedules_professionalId_dayOfWeek_key" ON "professional_schedules"("professionalId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "bookings_professionalId_idx" ON "bookings"("professionalId");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_schedules" ADD CONSTRAINT "professional_schedules_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
