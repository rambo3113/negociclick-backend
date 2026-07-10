-- AlterTable: password ahora es opcional (cuentas creadas solo con Google no tienen)
ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;

-- AlterTable: campos de Google OAuth
ALTER TABLE "users" ADD COLUMN "googleId" TEXT;
ALTER TABLE "users" ADD COLUMN "googleEmail" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");
