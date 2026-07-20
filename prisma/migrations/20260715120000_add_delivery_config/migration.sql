-- CreateTable delivery_configs
CREATE TABLE "delivery_configs" (
    "id"                 TEXT NOT NULL,
    "businessId"         TEXT NOT NULL,
    "pickupEnabled"      BOOLEAN NOT NULL DEFAULT true,
    "ownDeliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rappiEnabled"       BOOLEAN NOT NULL DEFAULT false,
    "boltEnabled"        BOOLEAN NOT NULL DEFAULT false,
    "glovoEnabled"       BOOLEAN NOT NULL DEFAULT false,
    "whatsappEnabled"    BOOLEAN NOT NULL DEFAULT false,
    "ownDeliveryPrice"   DECIMAL(10,2),
    "ownDeliveryTimeMin" INTEGER,
    "ownDeliveryTimeMax" INTEGER,
    "ownDeliveryNote"    TEXT,
    "rappiLink"          TEXT,
    "boltLink"           TEXT,
    "glovoLink"          TEXT,
    "whatsappNumber"     TEXT,
    "whatsappMessage"    TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_configs_businessId_key" ON "delivery_configs"("businessId");

-- AddForeignKey
ALTER TABLE "delivery_configs" ADD CONSTRAINT "delivery_configs_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddColumn delivery v2 fields to bookings
ALTER TABLE "bookings" ADD COLUMN "deliveryPrice"   DECIMAL(10,2);
ALTER TABLE "bookings" ADD COLUMN "deliveryTimeMin" INTEGER;
ALTER TABLE "bookings" ADD COLUMN "deliveryTimeMax" INTEGER;
