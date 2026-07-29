-- Task 1 (kiosk -> location resolution, actual event location) and Task 2
-- (manager clock-in override tracking). ADDITIVE ONLY: every existing row and
-- every existing enum value stays valid.

-- AlterEnum: add-only. Existing CARD / MOBILE_QR / MANUAL are untouched.
ALTER TYPE "AttendanceMethod" ADD VALUE 'MANAGER_OVERRIDE';
ALTER TYPE "AttendanceMethod" ADD VALUE 'ADMIN_OVERRIDE';

-- AlterTable: Kiosk gains an authoritative Location relation (the legacy
-- free-text "location" column is kept for backward compatibility).
ALTER TABLE "Kiosk" ADD COLUMN "locationId" TEXT;

-- AlterTable: Attendance gains the actual clock-IN location. (clockOutLocationId
-- already exists from the Stage 2 geolocation migration.)
ALTER TABLE "Attendance" ADD COLUMN "clockInLocationId" TEXT;

-- CreateTable: ClockAttempt (feeds the manager override eligibility rule).
CREATE TABLE "ClockAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kioskId" TEXT,
    "locationId" TEXT,
    "action" "AttendanceOtpAction" NOT NULL,
    "successful" BOOLEAN NOT NULL,
    "reason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClockAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ManagerOverrideAudit (permanent; no cascading relations so it
-- is never deleted when an attendance record is later edited or removed).
CREATE TABLE "ManagerOverrideAudit" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "attendanceId" TEXT,
    "locationId" TEXT,
    "action" "AttendanceOtpAction" NOT NULL DEFAULT 'CLOCK_IN',
    "reason" TEXT NOT NULL,
    "qualifyingFailedAttempts" INTEGER NOT NULL,
    "failedAttemptIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagerOverrideAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Kiosk_locationId_idx" ON "Kiosk"("locationId");
CREATE INDEX "Attendance_clockInLocationId_idx" ON "Attendance"("clockInLocationId");
CREATE INDEX "Attendance_clockOutLocationId_idx" ON "Attendance"("clockOutLocationId");
CREATE INDEX "ClockAttempt_userId_attemptedAt_idx" ON "ClockAttempt"("userId", "attemptedAt");
CREATE INDEX "ClockAttempt_locationId_attemptedAt_idx" ON "ClockAttempt"("locationId", "attemptedAt");
CREATE INDEX "ClockAttempt_userId_action_successful_resolvedAt_idx" ON "ClockAttempt"("userId", "action", "successful", "resolvedAt");
CREATE INDEX "ManagerOverrideAudit_employeeId_idx" ON "ManagerOverrideAudit"("employeeId");
CREATE INDEX "ManagerOverrideAudit_managerId_idx" ON "ManagerOverrideAudit"("managerId");
CREATE INDEX "ManagerOverrideAudit_attendanceId_idx" ON "ManagerOverrideAudit"("attendanceId");

-- AddForeignKey
ALTER TABLE "Kiosk" ADD CONSTRAINT "Kiosk_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_clockInLocationId_fkey" FOREIGN KEY ("clockInLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_clockOutLocationId_fkey" FOREIGN KEY ("clockOutLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_kioskInId_fkey" FOREIGN KEY ("kioskInId") REFERENCES "Kiosk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_kioskOutId_fkey" FOREIGN KEY ("kioskOutId") REFERENCES "Kiosk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClockAttempt" ADD CONSTRAINT "ClockAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClockAttempt" ADD CONSTRAINT "ClockAttempt_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "Kiosk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClockAttempt" ADD CONSTRAINT "ClockAttempt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Best-effort backfill: link existing kiosks to a Location whose name matches
-- the legacy free-text label. Kiosks left NULL must be assigned a location by
-- an admin (via /admin/kiosk-devices) before they can process attendance.
UPDATE "Kiosk" k
SET "locationId" = l."id"
FROM "Location" l
WHERE k."locationId" IS NULL
  AND k."location" IS NOT NULL
  AND l."name" = k."location";
