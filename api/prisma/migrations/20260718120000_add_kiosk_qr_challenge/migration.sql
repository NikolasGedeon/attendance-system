-- CreateTable
CREATE TABLE "KioskQrChallenge" (
    "id" TEXT NOT NULL,
    "kioskId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "action" "AttendanceOtpAction",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskQrChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KioskQrChallenge_tokenHash_key" ON "KioskQrChallenge"("tokenHash");

-- CreateIndex
CREATE INDEX "KioskQrChallenge_kioskId_idx" ON "KioskQrChallenge"("kioskId");

-- CreateIndex
CREATE INDEX "KioskQrChallenge_expiresAt_idx" ON "KioskQrChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "KioskQrChallenge_usedAt_idx" ON "KioskQrChallenge"("usedAt");

-- AddForeignKey
ALTER TABLE "KioskQrChallenge" ADD CONSTRAINT "KioskQrChallenge_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "Kiosk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskQrChallenge" ADD CONSTRAINT "KioskQrChallenge_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Guard against concurrent duplicate clock-ins: at most ONE open attendance
-- record (clockOut IS NULL) per user. Completed records (clockOut set) are
-- entirely unaffected, and clocking out simply fills clockOut on the single
-- open row, so this cannot block clock-out.
-- NOTE: partial indexes cannot be expressed in schema.prisma; this is
-- intentionally raw SQL. If this statement fails on an existing database,
-- there are already duplicate open rows — close the older duplicates via
-- the admin attendance adjustment before re-running the migration.
CREATE UNIQUE INDEX "Attendance_one_open_per_user"
    ON "Attendance"("userId")
    WHERE "clockOut" IS NULL;
