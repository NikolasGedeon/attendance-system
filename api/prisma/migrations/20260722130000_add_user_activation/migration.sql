-- Stage 3: account activation. Additive only — historical rows stay valid.
-- New enum, new purpose-scoped token table, and nullable/defaulted User columns.

-- CreateEnum
CREATE TYPE "SecurityTokenPurpose" AS ENUM ('ACCOUNT_ACTIVATION', 'PASSWORD_RESET');

-- AlterTable: User activation fields. isActivated defaults TRUE so every
-- existing user remains activated and able to log in.
ALTER TABLE "User" ADD COLUMN "isActivated" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "activatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "lastActivationEmailAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "activationEmailStatus" TEXT;
ALTER TABLE "User" ADD COLUMN "activationEmailError" TEXT;

-- CreateTable
CREATE TABLE "UserSecurityToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "SecurityTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSecurityToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSecurityToken_tokenHash_key" ON "UserSecurityToken"("tokenHash");
CREATE INDEX "UserSecurityToken_userId_purpose_idx" ON "UserSecurityToken"("userId", "purpose");
CREATE INDEX "UserSecurityToken_expiresAt_idx" ON "UserSecurityToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "UserSecurityToken" ADD CONSTRAINT "UserSecurityToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
