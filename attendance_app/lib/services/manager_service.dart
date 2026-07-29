import 'api_client.dart';

/// One row of the manager Live Attendance screen. Every field is computed
/// server-side; the client only renders. `managerClockInAvailable` in
/// particular is NEVER trusted from local state — it comes from the backend.
class LiveAttendanceRow {
  final String employeeId;
  final String employeeName;
  final String? assignedLocation;
  final String currentStatus; // CLOCKED_IN | CLOCKED_OUT | NEVER
  final DateTime? clockInTime;
  final DateTime? clockOutTime;
  final String? actualClockInLocation;
  final String? actualClockOutLocation;
  final String? clockInMethod;
  final String? clockOutMethod;
  final String? clockInKiosk;
  final String? clockOutKiosk;
  final int failedClockInAttempts;
  final bool managerClockInAvailable;

  LiveAttendanceRow({
    required this.employeeId,
    required this.employeeName,
    required this.assignedLocation,
    required this.currentStatus,
    required this.clockInTime,
    required this.clockOutTime,
    required this.actualClockInLocation,
    required this.actualClockOutLocation,
    required this.clockInMethod,
    required this.clockOutMethod,
    required this.clockInKiosk,
    required this.clockOutKiosk,
    required this.failedClockInAttempts,
    required this.managerClockInAvailable,
  });

  bool get isClockedIn => currentStatus == 'CLOCKED_IN';

  static DateTime? _dt(dynamic v) =>
      v == null ? null : DateTime.tryParse(v.toString())?.toLocal();

  factory LiveAttendanceRow.fromJson(Map<String, dynamic> j) {
    final assigned = j['assignedLocation'];
    return LiveAttendanceRow(
      employeeId: j['employeeId']?.toString() ?? '',
      employeeName: j['employeeName']?.toString() ?? '',
      assignedLocation:
          assigned is Map ? assigned['name']?.toString() : assigned?.toString(),
      currentStatus: j['currentStatus']?.toString() ?? 'NEVER',
      clockInTime: _dt(j['clockInTime']),
      clockOutTime: _dt(j['clockOutTime']),
      actualClockInLocation: j['actualClockInLocation']?.toString(),
      actualClockOutLocation: j['actualClockOutLocation']?.toString(),
      clockInMethod: j['clockInMethod']?.toString(),
      clockOutMethod: j['clockOutMethod']?.toString(),
      clockInKiosk: j['clockInKiosk']?.toString(),
      clockOutKiosk: j['clockOutKiosk']?.toString(),
      failedClockInAttempts:
          (j['failedClockInAttempts'] as num?)?.toInt() ?? 0,
      managerClockInAvailable: j['managerClockInAvailable'] == true,
    );
  }
}

class ManagerService {
  final ApiClient _api = ApiClient.instance;

  /// GET /manager/live-attendance
  Future<List<LiveAttendanceRow>> getLiveAttendance() async {
    final data = await _api.get('/manager/live-attendance');
    final list = (data is Map ? data['employees'] : data) as List<dynamic>?;
    return (list ?? [])
        .map((e) => LiveAttendanceRow.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /manager/failed-clock-attempts
  Future<List<Map<String, dynamic>>> getFailedClockAttempts() async {
    final data = await _api.get('/manager/failed-clock-attempts');
    final list = (data is Map ? data['attempts'] : data) as List<dynamic>?;
    return (list ?? []).cast<Map<String, dynamic>>();
  }

  /// POST /manager/attendance/:userId/clock-in
  Future<Map<String, dynamic>> clockInEmployee(
    String userId,
    String reason,
  ) async {
    final data = await _api.post(
      '/manager/attendance/$userId/clock-in',
      body: {'reason': reason},
    );
    return (data as Map<String, dynamic>?) ?? {};
  }
}
