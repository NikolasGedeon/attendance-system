-- Company management. ADDITIVE ONLY: new table + two nullable FK columns.
-- No existing row is modified; every existing user and attendance record
-- stays valid. EXTERNAL-requires-company is enforced in application logic,
-- never as a NOT NULL constraint, so legacy data never blocks the migration.

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- AlterTable: nullable company link on User and a historical snapshot on Attendance
ALTER TABLE "User" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Attendance" ADD COLUMN "companyId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");
CREATE INDEX "Company_isActive_idx" ON "Company"("isActive");
CREATE INDEX "User_companyId_idx" ON "User"("companyId");
CREATE INDEX "Attendance_companyId_idx" ON "Attendance"("companyId");

-- AddForeignKey: optional relations use ON DELETE SET NULL so a company can
-- never accidentally cascade-delete users or attendance records.
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
