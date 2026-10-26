-- Automatic closing of forgotten shifts. ADDITIVE ONLY: one new enum value.
-- No existing row is modified and no existing enum value changes, so all
-- historical data stays valid.
--
-- AUTO_CLOSE is written to Attendance.methodOut by the nightly job in
-- AttendanceAutoCloseService. It is never a value a client can send: it marks
-- a shift the employee never closed, so reports can tell a real clock-out
-- from one the system supplied.

-- AlterEnum: add-only (existing values untouched)
ALTER TYPE "AttendanceMethod" ADD VALUE 'AUTO_CLOSE';
