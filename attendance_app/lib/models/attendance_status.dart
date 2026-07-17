class AttendanceRecord {
  final String id;
  final String? userId;
  final DateTime? clockIn;
  final DateTime? clockOut;
  final double? latitude;
  final double? longitude;

  const AttendanceRecord({
    required this.id,
    this.userId,
    this.clockIn,
    this.clockOut,
    this.latitude,
    this.longitude,
  });

  factory AttendanceRecord.fromJson(Map<String, dynamic> json) {
    return AttendanceRecord(
      id: json['id'] as String? ?? '',
      userId: json['userId'] as String?,
      clockIn: json['clockIn'] != null
          ? DateTime.tryParse(json['clockIn'] as String)
          : null,
      clockOut: json['clockOut'] != null
          ? DateTime.tryParse(json['clockOut'] as String)
          : null,
      latitude: (json['latitude'] as num?)?.toDouble(),
      longitude: (json['longitude'] as num?)?.toDouble(),
    );
  }
}

class AttendanceStatus {
  final bool isClockedIn;
  final bool forceClockOut;
  final bool canClockIn;
  final double? hoursOpen;
  final String message;
  final AttendanceRecord? attendance;

  const AttendanceStatus({
    required this.isClockedIn,
    required this.forceClockOut,
    required this.canClockIn,
    this.hoursOpen,
    required this.message,
    this.attendance,
  });

  factory AttendanceStatus.fromJson(Map<String, dynamic> json) {
    return AttendanceStatus(
      isClockedIn: json['isClockedIn'] as bool? ?? false,
      forceClockOut: json['forceClockOut'] as bool? ?? false,
      canClockIn: json['canClockIn'] as bool? ?? false,
      hoursOpen: (json['hoursOpen'] as num?)?.toDouble(),
      message: json['message'] as String? ?? '',
      attendance: json['attendance'] != null
          ? AttendanceRecord.fromJson(
              json['attendance'] as Map<String, dynamic>)
          : null,
    );
  }
}
