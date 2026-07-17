import '../models/report_models.dart';
import 'api_client.dart';

class ReportsService {
  final ApiClient _api = ApiClient.instance;

  /// GET /attendance/reports/daily?date=YYYY-MM-DD
  Future<DailyReport> getDailyReport(String date) async {
    final data = await _api.get('/attendance/reports/daily?date=$date')
        as Map<String, dynamic>;
    return DailyReport.fromJson(data);
  }

  /// GET /attendance/reports/monthly?year=YYYY&month=M
  Future<List<MonthlyUserReport>> getMonthlyReport(
      int year, int month) async {
    final data = await _api
        .get('/attendance/reports/monthly?year=$year&month=$month')
        as List<dynamic>;
    return data
        .map((r) => MonthlyUserReport.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  // -------------------------------------------------------------------
  // Advanced reports (parsed defensively as maps)
  // -------------------------------------------------------------------

  Map<String, String> _filterParams({
    required String dateFrom,
    required String dateTo,
    String? period,
    String? search,
    String? locationId,
    String? employeeType,
    String? position,
    String? department,
  }) {
    return <String, String>{
      'dateFrom': dateFrom,
      'dateTo': dateTo,
      if (period != null && period.isNotEmpty) 'period': period,
      if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
      if (locationId != null && locationId.isNotEmpty)
        'locationId': locationId,
      if (employeeType != null && employeeType.isNotEmpty)
        'employeeType': employeeType,
      if (position != null && position.trim().isNotEmpty)
        'position': position.trim(),
      if (department != null && department.trim().isNotEmpty)
        'department': department.trim(),
    };
  }

  /// GET /attendance/reports/advanced
  Future<Map<String, dynamic>> getAdvancedReport({
    required String dateFrom,
    required String dateTo,
    String period = 'daily',
    String? search,
    String? locationId,
    String? employeeType,
    String? position,
    String? department,
  }) async {
    final params = _filterParams(
      dateFrom: dateFrom,
      dateTo: dateTo,
      period: period,
      search: search,
      locationId: locationId,
      employeeType: employeeType,
      position: position,
      department: department,
    );
    final query = Uri(queryParameters: params).query;
    final data = await _api.get('/attendance/reports/advanced?$query')
        as Map<String, dynamic>;
    return data;
  }

  /// GET /attendance/reports/absence
  Future<Map<String, dynamic>> getAbsenceReport({
    required String dateFrom,
    required String dateTo,
    String? search,
    String? locationId,
    String? employeeType,
    String? position,
    String? department,
  }) async {
    final params = _filterParams(
      dateFrom: dateFrom,
      dateTo: dateTo,
      search: search,
      locationId: locationId,
      employeeType: employeeType,
      position: position,
      department: department,
    );
    final query = Uri(queryParameters: params).query;
    final data = await _api.get('/attendance/reports/absence?$query')
        as Map<String, dynamic>;
    return data;
  }

  /// GET /attendance/reports/advanced/export — downloads xlsx/csv.
  /// Returns the saved path on mobile/desktop, null on web.
  Future<String?> exportAdvancedReport({
    required String dateFrom,
    required String dateTo,
    String period = 'daily',
    String? search,
    String? locationId,
    String? employeeType,
    String? position,
    String? department,
    String format = 'xlsx',
  }) {
    final params = _filterParams(
      dateFrom: dateFrom,
      dateTo: dateTo,
      period: period,
      search: search,
      locationId: locationId,
      employeeType: employeeType,
      position: position,
      department: department,
    )..['format'] = format;
    return _api.downloadFile(
      path: '/attendance/reports/advanced/export',
      queryParams: params,
      filename: 'attendance-report-${dateFrom}_$dateTo.$format',
    );
  }

  /// GET /attendance/reports/absence/export — downloads xlsx/csv.
  Future<String?> exportAbsenceReport({
    required String dateFrom,
    required String dateTo,
    String? search,
    String? locationId,
    String? employeeType,
    String? position,
    String? department,
    String format = 'xlsx',
  }) {
    final params = _filterParams(
      dateFrom: dateFrom,
      dateTo: dateTo,
      search: search,
      locationId: locationId,
      employeeType: employeeType,
      position: position,
      department: department,
    )..['format'] = format;
    return _api.downloadFile(
      path: '/attendance/reports/absence/export',
      queryParams: params,
      filename: 'absence-report-${dateFrom}_$dateTo.$format',
    );
  }

  /// GET /users/template/export — downloads the user import template.
  Future<String?> exportUsersTemplate({String format = 'xlsx'}) {
    return _api.downloadFile(
      path: '/users/template/export',
      queryParams: format == 'xlsx' ? null : {'format': format},
      filename: 'users-import-template.$format',
    );
  }
}
