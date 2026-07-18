import 'api_client.dart';
import 'kiosk_service.dart' show kioskDeviceKey;

/// QR payload prefix so the phone can instantly ignore non-kiosk QR codes.
/// Kiosk encodes '$kioskQrPrefix<token>'; the phone strips the prefix and
/// sends only the opaque token to the backend.
const String kioskQrPrefix = 'AQR1:';

/// Result of POST /kiosk-qr/challenge (kiosk side).
class KioskQrChallenge {
  final String challengeId;
  final String token;
  final DateTime? expiresAt;
  final int refreshInSeconds;

  const KioskQrChallenge({
    required this.challengeId,
    required this.token,
    this.expiresAt,
    this.refreshInSeconds = 25,
  });

  String get qrPayload => '$kioskQrPrefix$token';

  factory KioskQrChallenge.fromJson(Map<String, dynamic> json) {
    return KioskQrChallenge(
      challengeId: json['challengeId'] as String? ?? '',
      token: json['token'] as String? ?? '',
      expiresAt: json['expiresAt'] != null
          ? DateTime.tryParse(json['expiresAt'] as String)
          : null,
      refreshInSeconds: (json['refreshInSeconds'] as num?)?.toInt() ?? 25,
    );
  }
}

/// Result of POST /kiosk-qr/challenge/:id/status (kiosk side).
class KioskQrStatus {
  final String status; // pending | consumed | expired
  final String? employeeName;
  final String? action; // CLOCK_IN | CLOCK_OUT
  final DateTime? time;

  const KioskQrStatus({
    required this.status,
    this.employeeName,
    this.action,
    this.time,
  });

  bool get isPending => status == 'pending';
  bool get isConsumed => status == 'consumed';
  bool get isExpired => status == 'expired';

  factory KioskQrStatus.fromJson(Map<String, dynamic> json) {
    return KioskQrStatus(
      status: json['status'] as String? ?? 'pending',
      employeeName: json['employeeName'] as String?,
      action: json['action'] as String?,
      time: json['time'] != null
          ? DateTime.tryParse(json['time'] as String)
          : null,
    );
  }
}

/// Result of POST /kiosk-qr/scan (employee phone side).
class KioskQrScanResult {
  final String action; // CLOCK_IN | CLOCK_OUT
  final String? employeeName;
  final DateTime? time;
  final String? kioskName;
  final String? kioskLocation;

  const KioskQrScanResult({
    required this.action,
    this.employeeName,
    this.time,
    this.kioskName,
    this.kioskLocation,
  });

  factory KioskQrScanResult.fromJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>?;
    final kiosk = json['kiosk'] as Map<String, dynamic>?;
    final attendance = json['attendance'] as Map<String, dynamic>?;
    final action = json['action'] as String? ?? '';

    dynamic rawTime;
    if (attendance != null) {
      rawTime = action == 'CLOCK_OUT'
          ? attendance['clockOut']
          : attendance['clockIn'];
    }
    return KioskQrScanResult(
      action: action,
      employeeName: user?['fullName'] as String?,
      time: rawTime is String ? DateTime.tryParse(rawTime) : null,
      kioskName: kiosk?['name'] as String?,
      kioskLocation: kiosk?['location'] as String?,
    );
  }
}

class KioskQrService {
  final ApiClient _api = ApiClient.instance;

  /// Kiosk: POST /kiosk-qr/challenge — new short-lived QR challenge.
  Future<KioskQrChallenge> createChallenge() async {
    final data = await _api.post(
      '/kiosk-qr/challenge',
      body: {'kioskDeviceKey': kioskDeviceKey},
      auth: false,
    ) as Map<String, dynamic>;
    return KioskQrChallenge.fromJson(data);
  }

  /// Kiosk: POST /kiosk-qr/challenge/:id/status — poll for consumption.
  Future<KioskQrStatus> challengeStatus(String challengeId) async {
    final data = await _api.post(
      '/kiosk-qr/challenge/$challengeId/status',
      body: {'kioskDeviceKey': kioskDeviceKey},
      auth: false,
    ) as Map<String, dynamic>;
    return KioskQrStatus.fromJson(data);
  }

  /// True when a scanned QR payload looks like an attendance kiosk QR.
  static bool isKioskQrPayload(String? payload) =>
      payload != null && payload.startsWith(kioskQrPrefix);

  /// Phone: POST /kiosk-qr/scan — consume a scanned kiosk QR (JWT).
  Future<KioskQrScanResult> scan(String qrPayload) async {
    final token = qrPayload.startsWith(kioskQrPrefix)
        ? qrPayload.substring(kioskQrPrefix.length)
        : qrPayload;
    final data = await _api.post(
      '/kiosk-qr/scan',
      body: {'token': token.trim()},
    ) as Map<String, dynamic>;
    return KioskQrScanResult.fromJson(data);
  }
}
