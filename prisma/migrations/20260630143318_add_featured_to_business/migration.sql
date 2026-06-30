-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featuredUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "businesses_featured_featuredUntil_idx" ON "businesses"("featured", "featuredUntil");
