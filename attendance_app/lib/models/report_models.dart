import 'location_model.dart';

/// One attendance record inside the daily report.
class DailyReportRecord {
  final String id;
  final String userId;
  final String userFullName;
  final DateTime? clockIn;
  final DateTime? clockOut;
  final double? workedHours;

  const DailyReportRecord({
    required this.id,
    required this.userId,
    required this.userFullName,
    this.clockIn,
    this.clockOut,
    this.workedHours,
  });

  factory DailyReportRecord.fromJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>?;
    return DailyReportRecord(
      id: json['id'] as String? ?? '',
      userId: json['userId'] as String? ?? '',
      userFullName: user?['fullName'] as String? ?? 'Unknown',
      clockIn: json['clockIn'] != null
          ? DateTime.tryParse(json['clockIn'] as String)
          : null,
      clockOut: json['clockOut'] != null
          ? DateTime.tryParse(json['clockOut'] as String)
          : null,
      workedHours: (json['workedHours'] as num?)?.toDouble(),
    );
  }
}

class DailyReport {
  final String date;
  final int totalEmployeesClockedIn;
  final int currentlyClockedIn;
  final int totalRecords;
  final double totalWorkedHours;
  final List<DailyReportRecord> records;

  const DailyReport({
    required this.date,
    required this.totalEmployeesClockedIn,
    required this.currentlyClockedIn,
    required this.totalRecords,
    required this.totalWorkedHours,
    required this.records,
  });

  factory DailyReport.fromJson(Map<String, dynamic> json) {
    return DailyReport(
      date: json['date'] as String? ?? '',
      totalEmployeesClockedIn:
          (json['totalEmployeesClockedIn'] as num?)?.toInt() ?? 0,
      currentlyClockedIn: (json['currentlyClockedIn'] as num?)?.toInt() ?? 0,
      totalRecords: (json['totalRecords'] as num?)?.toInt() ?? 0,
      totalWorkedHours: (json['totalWorkedHours'] as num?)?.toDouble() ?? 0,
      records: (json['records'] as List<dynamic>? ?? [])
          .map((r) => DailyReportRecord.fromJson(r as Map<String, dynamic>))
          .toList(),
    );
  }
}

/// One row of the monthly report (totals per user).
class MonthlyUserReport {
  final String userId;
  final String fullName;
  final String email;
  final String role;
  final LocationModel? location;
  final int totalMinutes;
  final double totalHours;
  final int recordsCount;

  const MonthlyUserReport({
    required this.userId,
    required this.fullName,
    required this.email,
    required this.role,
    this.location,
    required this.totalMinutes,
    required this.totalHours,
    required this.recordsCount,
  });

  factory MonthlyUserReport.fromJson(Map<String, dynamic> json) {
    return MonthlyUserReport(
      userId: json['userId'] as String? ?? '',
      fullName: json['fullName'] as String? ?? '',
      email: json['email'] as String? ?? '',
      role: json['role'] as String? ?? '',
      location: json['location'] != null
          ? LocationModel.fromJson(json['location'] as Map<String, dynamic>)
          : null,
      totalMinutes: (json['totalMinutes'] as num?)?.toInt() ?? 0,
      totalHours: (json['totalHours'] as num?)?.toDouble() ?? 0,
      recordsCount: (json['recordsCount'] as num?)?.toInt() ?? 0,
    );
  }
}
