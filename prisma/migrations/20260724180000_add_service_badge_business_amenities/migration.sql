-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "amenities" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "onlyMen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onlyWomen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "specialties" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "badge" TEXT,
ADD COLUMN     "badgeOrder" INTEGER NOT NULL DEFAULT 0;
