-- CreateTable
CREATE TABLE "MobileAttendanceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileAttendanceToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MobileAttendanceToken_userId_idx" ON "MobileAttendanceToken"("userId");

-- CreateIndex
CREATE INDEX "MobileAttendanceToken_tokenHash_idx" ON "MobileAttendanceToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MobileAttendanceToken_expiresAt_idx" ON "MobileAttendanceToken"("expiresAt");

-- CreateIndex
CREATE INDEX "MobileAttendanceToken_usedAt_idx" ON "MobileAttendanceToken"("usedAt");

-- AddForeignKey
ALTER TABLE "MobileAttendanceToken" ADD CONSTRAINT "MobileAttendanceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
