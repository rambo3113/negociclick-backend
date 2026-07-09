-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "culqiKeysValidatedAt" TIMESTAMP(3),
ADD COLUMN     "culqiPublicKey" TEXT,
ADD COLUMN     "culqiSecretKeyEnc" TEXT,
ADD COLUMN     "paymentInstructions" TEXT;
