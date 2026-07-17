-- CreateTable
CREATE TABLE "AttendanceAdjustmentLog" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "oldClockIn" TIMESTAMP(3),
    "oldClockOut" TIMESTAMP(3),
    "newClockIn" TIMESTAMP(3),
    "newClockOut" TIMESTAMP(3),
    "oldLatitude" DOUBLE PRECISION,
    "oldLongitude" DOUBLE PRECISION,
    "newLatitude" DOUBLE PRECISION,
    "newLongitude" DOUBLE PRECISION,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceAdjustmentLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceAdjustmentLog_attendanceId_idx" ON "AttendanceAdjustmentLog"("attendanceId");

-- CreateIndex
CREATE INDEX "AttendanceAdjustmentLog_changedById_idx" ON "AttendanceAdjustmentLog"("changedById");

-- AddForeignKey
ALTER TABLE "AttendanceAdjustmentLog" ADD CONSTRAINT "AttendanceAdjustmentLog_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAdjustmentLog" ADD CONSTRAINT "AttendanceAdjustmentLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
