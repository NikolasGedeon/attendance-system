import 'package:flutter/material.dart';

import '../../models/report_models.dart';
import '../../services/api_client.dart';
import '../../services/reports_service.dart';

class ReportsAdminScreen extends StatelessWidget {
  const ReportsAdminScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Reports'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Daily'),
              Tab(text: 'Monthly'),
            ],
          ),
        ),
        body: const TabBarView(
          children: [
            _DailyReportTab(),
            _MonthlyReportTab(),
          ],
        ),
      ),
    );
  }
}

String _two(int n) => n.toString().padLeft(2, '0');

String _formatTime(DateTime? dt) {
  if (dt == null) return '—';
  final l = dt.toLocal();
  return '${_two(l.hour)}:${_two(l.minute)}';
}

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

class _DailyReportTab extends StatefulWidget {
  const _DailyReportTab();

  @override
  State<_DailyReportTab> createState() => _DailyReportTabState();
}

class _DailyReportTabState extends State<_DailyReportTab> {
  final _reportsService = ReportsService();

  DateTime _date = DateTime.now();
  DailyReport? _report;
  bool _loading = false;
  String? _error;

  String get _dateString =>
      '${_date.year}-${_two(_date.month)}-${_two(_date.day)}';

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2024),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final report = await _reportsService.getDailyReport(_dateString);
      if (mounted) setState(() => _report = report);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final report = _report;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _pickDate,
                icon: const Icon(Icons.calendar_today, size: 18),
                label: Text(_dateString),
              ),
            ),
            const SizedBox(width: 12),
            FilledButton(
              onPressed: _loading ? null : _fetch,
              child: _loading
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Fetch'),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (_error != null)
          Text(_error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error)),
        if (report != null) ...[
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Summary — ${report.date}',
                      style: const TextStyle(fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text('Employees clocked in: '
                      '${report.totalEmployeesClockedIn}'),
                  Text('Currently clocked in: ${report.currentlyClockedIn}'),
                  Text('Total records: ${report.totalRecords}'),
                  Text('Total worked hours: ${report.totalWorkedHours}'),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          if (report.records.isEmpty)
            const Padding(
              padding: EdgeInsets.all(16),
              child: Center(child: Text('No records for this date.')),
            ),
          ...report.records.map(
            (r) => Card(
              child: ListTile(
                title: Text(r.userFullName),
                subtitle: Text(
                  'In: ${_formatTime(r.clockIn)} · '
                  'Out: ${_formatTime(r.clockOut)}',
                ),
                trailing: Text(
                  r.workedHours != null
                      ? '${r.workedHours!.toStringAsFixed(2)} h'
                      : 'Open',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Monthly
// ---------------------------------------------------------------------------

class _MonthlyReportTab extends StatefulWidget {
  const _MonthlyReportTab();

  @override
  State<_MonthlyReportTab> createState() => _MonthlyReportTabState();
}

class _MonthlyReportTabState extends State<_MonthlyReportTab> {
  final _reportsService = ReportsService();

  late final TextEditingController _yearController =
      TextEditingController(text: DateTime.now().year.toString());
  late final TextEditingController _monthController =
      TextEditingController(text: DateTime.now().month.toString());

  List<MonthlyUserReport>? _rows;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _yearController.dispose();
    _monthController.dispose();
    super.dispose();
  }

  Future<void> _fetch() async {
    final year = int.tryParse(_yearController.text.trim());
    final month = int.tryParse(_monthController.text.trim());
    if (year == null || year < 2000 || year > 2100) {
      setState(() => _error = 'Enter a valid year');
      return;
    }
    if (month == null || month < 1 || month > 12) {
      setState(() => _error = 'Enter a valid month (1-12)');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await _reportsService.getMonthlyReport(year, month);
      if (mounted) setState(() => _rows = rows);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _yearController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Year',
                  border: OutlineInputBorder(),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: _monthController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Month',
                  border: OutlineInputBorder(),
                ),
              ),
            ),
            const SizedBox(width: 12),
            FilledButton(
              onPressed: _loading ? null : _fetch,
              child: _loading
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Fetch'),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (_error != null)
          Text(_error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error)),
        if (rows != null) ...[
          if (rows.isEmpty)
            const Padding(
              padding: EdgeInsets.all(16),
              child:
                  Center(child: Text('No completed records this month.')),
            ),
          ...rows.map(
            (r) => Card(
              child: ListTile(
                title: Text(r.fullName),
                subtitle: Text(
                  '${r.email}\n'
                  '${r.location?.name ?? 'No location'} · '
                  '${r.recordsCount} record(s)',
                ),
                isThreeLine: true,
                trailing: Text(
                  '${r.totalHours.toStringAsFixed(2)} h',
                  style: const TextStyle(
                      fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}
