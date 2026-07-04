-- CreateEnum
CREATE TYPE "BusinessOrderMode" AS ENUM ('APPOINTMENT', 'ORDER');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "deliveryAddress" TEXT;

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "orderMode" "BusinessOrderMode" NOT NULL DEFAULT 'APPOINTMENT';
