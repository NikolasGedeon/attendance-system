import '../models/attendance_status.dart';
import 'api_client.dart';

class AttendanceService {
  final ApiClient _api = ApiClient.instance;

  /// GET /attendance/status
  Future<AttendanceStatus> getStatus() async {
    final data = await _api.get('/attendance/status') as Map<String, dynamic>;
    return AttendanceStatus.fromJson(data);
  }

  /// POST /attendance/clock-in with GPS coordinates.
  /// Returns the assigned location name from locationValidation, if present.
  Future<String?> clockIn(double latitude, double longitude) async {
    final data = await _api.post('/attendance/clock-in', body: {
      'latitude': latitude,
      'longitude': longitude,
    });
    return _extractLocationName(data);
  }

  /// POST /attendance/clock-out with a fresh GPS fix.
  /// [capturedAt] is the GPS-fix time (sent for freshness only); the official
  /// clock-out time is set by the backend.
  Future<void> clockOut(
    double latitude,
    double longitude, {
    double? accuracyMeters,
    DateTime? capturedAt,
  }) async {
    await _api.post('/attendance/clock-out', body: {
      'latitude': latitude,
      'longitude': longitude,
      if (accuracyMeters != null) 'accuracyMeters': accuracyMeters,
      if (capturedAt != null)
        'capturedAt': capturedAt.toUtc().toIso8601String(),
    });
  }

  /// Defensively digs the assigned location name out of the clock-in
  /// response: locationValidation.assignedLocation.name (with fallbacks).
  String? _extractLocationName(dynamic data) {
    if (data is! Map<String, dynamic>) return null;
    final validation = data['locationValidation'];
    if (validation is Map<String, dynamic>) {
      final assigned = validation['assignedLocation'];
      if (assigned is Map<String, dynamic> && assigned['name'] is String) {
        return assigned['name'] as String;
      }
      if (validation['locationName'] is String) {
        return validation['locationName'] as String;
      }
    }
    final assigned = data['assignedLocation'];
    if (assigned is Map<String, dynamic> && assigned['name'] is String) {
      return assigned['name'] as String;
    }
    return null;
  }
}
