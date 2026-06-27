-- CreateIndex
CREATE INDEX "availability_blocks_businessId_startDate_endDate_idx" ON "availability_blocks"("businessId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "bookings_businessId_date_idx" ON "bookings"("businessId", "date");

-- CreateIndex
CREATE INDEX "bookings_businessId_date_status_idx" ON "bookings"("businessId", "date", "status");

-- CreateIndex
CREATE INDEX "bookings_clientId_status_idx" ON "bookings"("clientId", "status");

-- CreateIndex
CREATE INDEX "businesses_isActive_category_idx" ON "businesses"("isActive", "category");

-- CreateIndex
CREATE INDEX "businesses_isActive_city_idx" ON "businesses"("isActive", "city");

-- CreateIndex
CREATE INDEX "businesses_isActive_category_city_idx" ON "businesses"("isActive", "category", "city");

-- CreateIndex
CREATE INDEX "businesses_isActive_rating_idx" ON "businesses"("isActive", "rating");

-- CreateIndex
CREATE INDEX "payments_userId_status_idx" ON "payments"("userId", "status");

-- CreateIndex
CREATE INDEX "payments_userId_createdAt_idx" ON "payments"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "subscriptions_userId_status_idx" ON "subscriptions"("userId", "status");

-- CreateIndex
CREATE INDEX "subscriptions_status_endDate_idx" ON "subscriptions"("status", "endDate");
