-- KioskEnrollment: self-service universal-APK enrollment.
-- Additive only. No existing table/column is altered destructively, so
-- historical data and the currently-running app remain fully valid.

-- CreateEnum
CREATE TYPE "KioskEnrollmentStatus" AS ENUM ('PENDING', 'APPROVED', 'CONSUMED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "KioskEnrollment" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeLast4" TEXT NOT NULL,
    "status" "KioskEnrollmentStatus" NOT NULL DEFAULT 'PENDING',
    "deviceModel" TEXT,
    "deviceSerial" TEXT,
    "appVersion" TEXT,
    "kioskId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KioskEnrollment_codeHash_key" ON "KioskEnrollment"("codeHash");
CREATE INDEX "KioskEnrollment_status_idx" ON "KioskEnrollment"("status");
CREATE INDEX "KioskEnrollment_expiresAt_idx" ON "KioskEnrollment"("expiresAt");
CREATE INDEX "KioskEnrollment_kioskId_idx" ON "KioskEnrollment"("kioskId");
CREATE INDEX "KioskEnrollment_deviceSerial_idx" ON "KioskEnrollment"("deviceSerial");

-- AddForeignKey
ALTER TABLE "KioskEnrollment" ADD CONSTRAINT "KioskEnrollment_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "Kiosk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
