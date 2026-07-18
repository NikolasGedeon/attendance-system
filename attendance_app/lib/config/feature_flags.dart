/// Feature flags for the QR clocking direction.
///
/// The new visible workflow is: kiosk DISPLAYS a QR → employee phone SCANS
/// it. The old workflow (phone displays a rotating token QR, kiosk reads
/// it) is fully preserved in code and can be restored by flipping the
/// legacy flags below — no deleted code needs recovering.
library;

/// Old flow, phone side: "Send Token to Scanner" button on the attendance
/// screen opening MobileTokenScreen (rotating employee QR).
const bool enableLegacyEmployeeQrDisplay = false;

/// Old flow, kiosk side: "Mobile Token" button on the kiosk waiting screen
/// opening the manual employee-token entry stage.
const bool enableLegacyKioskEmployeeQrScan = false;

/// New flow: kiosk shows a short-lived QR challenge; the employee phone
/// scans it with the camera ("Scan Kiosk QR" / "Display QR for Clocking").
const bool enableKioskDisplayedQr = true;
