-- CreateEnum
CREATE TYPE "AttendanceOtpAction" AS ENUM ('CLOCK_IN', 'CLOCK_OUT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cardOtpFailedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cardOtpLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "requireOtpForCard" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AttendanceOtp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kioskId" TEXT NOT NULL,
    "cardUid" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "action" "AttendanceOtpAction" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceOtp_userId_idx" ON "AttendanceOtp"("userId");

-- CreateIndex
CREATE INDEX "AttendanceOtp_kioskId_idx" ON "AttendanceOtp"("kioskId");

-- CreateIndex
CREATE INDEX "AttendanceOtp_cardUid_idx" ON "AttendanceOtp"("cardUid");

-- CreateIndex
CREATE INDEX "AttendanceOtp_expiresAt_idx" ON "AttendanceOtp"("expiresAt");

-- CreateIndex
CREATE INDEX "AttendanceOtp_usedAt_idx" ON "AttendanceOtp"("usedAt");

-- CreateIndex
CREATE INDEX "Attendance_clockIn_idx" ON "Attendance"("clockIn");

-- CreateIndex
CREATE INDEX "Attendance_clockOut_idx" ON "Attendance"("clockOut");

-- CreateIndex
CREATE INDEX "Attendance_kioskInId_idx" ON "Attendance"("kioskInId");

-- CreateIndex
CREATE INDEX "Attendance_kioskOutId_idx" ON "Attendance"("kioskOutId");

-- CreateIndex
CREATE INDEX "User_cardUid_idx" ON "User"("cardUid");

-- CreateIndex
CREATE INDEX "User_employeeCode_idx" ON "User"("employeeCode");

-- CreateIndex
CREATE INDEX "User_phoneNumber_idx" ON "User"("phoneNumber");

-- AddForeignKey
ALTER TABLE "AttendanceOtp" ADD CONSTRAINT "AttendanceOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
