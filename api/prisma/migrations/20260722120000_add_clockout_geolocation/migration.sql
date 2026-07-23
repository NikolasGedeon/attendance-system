-- Stage 2: additive clock-out geolocation columns on "Attendance".
-- All columns are NULLABLE so every historical row remains valid with NULLs.
-- Clock-in coordinates ("latitude"/"longitude") are untouched.
-- NOTE: "clockOutCapturedAt" is the GPS-fix timestamp reported by the device,
-- NOT the official clock-out time (which stays in "clockOut", set by the server).

ALTER TABLE "Attendance" ADD COLUMN "clockOutLatitude" DOUBLE PRECISION;
ALTER TABLE "Attendance" ADD COLUMN "clockOutLongitude" DOUBLE PRECISION;
ALTER TABLE "Attendance" ADD COLUMN "clockOutAccuracyMeters" DOUBLE PRECISION;
ALTER TABLE "Attendance" ADD COLUMN "clockOutLocationId" TEXT;
ALTER TABLE "Attendance" ADD COLUMN "clockOutGeofenceStatus" TEXT;
ALTER TABLE "Attendance" ADD COLUMN "clockOutCapturedAt" TIMESTAMP(3);
