-- Kiosk config diagnostics + MOBILE_GPS attendance method. ADDITIVE ONLY:
-- two nullable columns and one new enum value. No existing row is modified and
-- no existing enum value changes, so all historical data stays valid.

-- AlterEnum: add-only (existing values untouched)
ALTER TYPE "AttendanceMethod" ADD VALUE 'MOBILE_GPS';

-- AlterTable: optional kiosk diagnostics reported via POST /kiosk/config
ALTER TABLE "Kiosk" ADD COLUMN "appVersion" TEXT;
ALTER TABLE "Kiosk" ADD COLUMN "deviceInfo" TEXT;
