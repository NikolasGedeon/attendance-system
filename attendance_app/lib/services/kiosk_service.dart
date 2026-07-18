import 'api_client.dart';

/// Per-tablet kiosk identity. Override at build time for each tablet:
///   flutter build apk --dart-define=KIOSK_DEVICE_KEY=LOBBY-KIOSK-02 ...
/// The default keeps the existing reception tablet working unchanged.
const String kioskDeviceKey = String.fromEnvironment(
  'KIOSK_DEVICE_KEY',
  defaultValue: 'RECEPTION-KIOSK-01',
);

/// Result of POST /kiosk/card-scan.
/// Either an immediate clock action, or an OTP challenge.
class CardScanResult {
  final bool requiresOtp;

  // OTP challenge fields
  final String? otpRequestId;
  final int? expiresInSeconds;
  final String? devOtpCode;
  final String? message;

  // Common / success fields
  final String action; // CLOCK_IN or CLOCK_OUT
  final String? userFullName;
  final Map<String, dynamic>? attendance;

  const CardScanResult({
    required this.requiresOtp,
    required this.action,
    this.otpRequestId,
    this.expiresInSeconds,
    this.devOtpCode,
    this.message,
    this.userFullName,
    this.attendance,
  });

  factory CardScanResult.fromJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>?;
    return CardScanResult(
      requiresOtp: json['requiresOtp'] == true,
      action: json['action'] as String? ?? '',
      otpRequestId: json['otpRequestId'] as String?,
      expiresInSeconds: (json['expiresInSeconds'] as num?)?.toInt(),
      devOtpCode: json['devOtpCode'] as String?,
      message: json['message'] as String?,
      userFullName: user?['fullName'] as String?,
      attendance: json['attendance'] as Map<String, dynamic>?,
    );
  }
}

/// Result of a completed clock action (verify-otp / manual-clock).
class KioskClockResult {
  final String action;
  final String? userFullName;
  final Map<String, dynamic>? attendance;

  const KioskClockResult({
    required this.action,
    this.userFullName,
    this.attendance,
  });

  factory KioskClockResult.fromJson(Map<String, dynamic> json) {
    // verify-otp puts the person under 'user'; manual-clock under 'employee'.
    final user = (json['user'] ?? json['employee']) as Map<String, dynamic>?;
    return KioskClockResult(
      action: json['action'] as String? ?? '',
      userFullName: user?['fullName'] as String?,
      attendance: json['attendance'] as Map<String, dynamic>?,
    );
  }
}

/// Result of POST /kiosk/admin/verify-card.
class AdminVerifyResult {
  final String adminFullName;
  final String adminRole;
  final String kioskName;

  const AdminVerifyResult({
    required this.adminFullName,
    required this.adminRole,
    required this.kioskName,
  });

  factory AdminVerifyResult.fromJson(Map<String, dynamic> json) {
    final admin = json['admin'] as Map<String, dynamic>?;
    final kiosk = json['kiosk'] as Map<String, dynamic>?;
    return AdminVerifyResult(
      adminFullName: admin?['fullName'] as String? ?? 'Admin',
      adminRole: admin?['role'] as String? ?? '',
      kioskName: kiosk?['name'] as String? ?? '',
    );
  }
}

/// Minimal employee entry for the kiosk Admin Help picker.
class KioskEmployee {
  final String id;
  final String fullName;
  final String? employeeCode;
  final String? department;
  final bool cardOtpLocked;

  const KioskEmployee({
    required this.id,
    required this.fullName,
    this.employeeCode,
    this.department,
    this.cardOtpLocked = false,
  });

  factory KioskEmployee.fromJson(Map<String, dynamic> json) {
    return KioskEmployee(
      id: json['id'] as String? ?? '',
      fullName: json['fullName'] as String? ?? '',
      employeeCode: json['employeeCode'] as String?,
      department: json['department'] as String?,
      cardOtpLocked: json['cardOtpLocked'] == true,
    );
  }
}

class KioskService {
  final ApiClient _api = ApiClient.instance;

  /// POST /kiosk/card-scan (no JWT — kiosk auths with its device key)
  Future<CardScanResult> cardScan(String cardUid) async {
    final data = await _api.post(
      '/kiosk/card-scan',
      body: {'cardUid': cardUid.trim(), 'kioskDeviceKey': kioskDeviceKey},
      auth: false,
    ) as Map<String, dynamic>;
    return CardScanResult.fromJson(data);
  }

  /// POST /kiosk/mobile-token-scan — rotating mobile token
  /// (separate from physical card UIDs).
  Future<KioskClockResult> mobileTokenScan(String token) async {
    final data = await _api.post(
      '/kiosk/mobile-token-scan',
      body: {'token': token.trim(), 'kioskDeviceKey': kioskDeviceKey},
      auth: false,
    ) as Map<String, dynamic>;
    return KioskClockResult.fromJson(data);
  }

  /// POST /kiosk/card-scan/verify-otp
  Future<KioskClockResult> verifyOtp({
    required String otpRequestId,
    required String code,
  }) async {
    final data = await _api.post(
      '/kiosk/card-scan/verify-otp',
      body: {
        'otpRequestId': otpRequestId,
        'code': code.trim(),
        'kioskDeviceKey': kioskDeviceKey,
      },
      auth: false,
    ) as Map<String, dynamic>;
    return KioskClockResult.fromJson(data);
  }

  /// POST /kiosk/admin/verify-card
  Future<AdminVerifyResult> adminVerifyCard(String adminCardUid) async {
    final data = await _api.post(
      '/kiosk/admin/verify-card',
      body: {
        'adminCardUid': adminCardUid.trim(),
        'kioskDeviceKey': kioskDeviceKey,
      },
      auth: false,
    ) as Map<String, dynamic>;
    return AdminVerifyResult.fromJson(data);
  }

  /// POST /kiosk/admin/manual-clock
  Future<KioskClockResult> adminManualClock({
    required String adminCardUid,
    required String employeeUserId,
    required String action, // CLOCK_IN or CLOCK_OUT
    required String reason,
  }) async {
    final data = await _api.post(
      '/kiosk/admin/manual-clock',
      body: {
        'adminCardUid': adminCardUid.trim(),
        'kioskDeviceKey': kioskDeviceKey,
        'employeeUserId': employeeUserId.trim(),
        'action': action,
        'reason': reason.trim(),
      },
      auth: false,
    ) as Map<String, dynamic>;
    return KioskClockResult.fromJson(data);
  }

  /// POST /kiosk/admin/users — employee list for the Admin Help picker.
  /// Protected by the verified admin card + kiosk device key (no JWT).
  Future<List<KioskEmployee>> adminListUsers(String adminCardUid) async {
    final data = await _api.post(
      '/kiosk/admin/users',
      body: {
        'adminCardUid': adminCardUid.trim(),
        'kioskDeviceKey': kioskDeviceKey,
      },
      auth: false,
    ) as Map<String, dynamic>;
    return (data['users'] as List<dynamic>? ?? [])
        .map((u) => KioskEmployee.fromJson(u as Map<String, dynamic>))
        .toList();
  }

  /// POST /kiosk/admin/clear-card-lock
  Future<void> adminClearCardLock({
    required String adminCardUid,
    required String employeeUserId,
  }) async {
    await _api.post(
      '/kiosk/admin/clear-card-lock',
      body: {
        'adminCardUid': adminCardUid.trim(),
        'kioskDeviceKey': kioskDeviceKey,
        'employeeUserId': employeeUserId.trim(),
      },
      auth: false,
    );
  }
}
