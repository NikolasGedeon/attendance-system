import 'package:flutter/material.dart';

import '../../services/api_client.dart';
import '../../services/reports_service.dart';
import 'report_filters.dart';

class AbsenceReportsScreen extends StatefulWidget {
  const AbsenceReportsScreen({super.key});

  @override
  State<AbsenceReportsScreen> createState() => _AbsenceReportsScreenState();
}

class _AbsenceReportsScreenState extends State<AbsenceReportsScreen> {
  final _reportsService = ReportsService();
  final _filters = ReportFilterValues();

  Map<String, dynamic>? _report;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _filters.dispose();
    super.dispose();
  }

  Future<void> _apply() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final report = await _reportsService.getAbsenceReport(
        dateFrom: _filters.dateFromStr,
        dateTo: _filters.dateToStr,
        search: _filters.searchController.text,
        locationId: _filters.locationId,
        employeeType: _filters.employeeType,
        position: _filters.positionController.text,
        department: _filters.departmentController.text,
      );
      if (mounted) setState(() => _report = report);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _export(String format) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final savedPath = await _reportsService.exportAbsenceReport(
        dateFrom: _filters.dateFromStr,
        dateTo: _filters.dateToStr,
        search: _filters.searchController.text,
        locationId: _filters.locationId,
        employeeType: _filters.employeeType,
        position: _filters.positionController.text,
        department: _filters.departmentController.text,
        format: format,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(savedPath == null
              ? 'Absence report downloaded (${format.toUpperCase()})'
              : 'Absence report saved to $savedPath'),
        ),
      );
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not export the report.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Absence Reports')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 860),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                'Absence Reports',
                style: Theme.of(context)
                    .textTheme
                    .headlineSmall
                    ?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 4),
              Text(
                'Review active users without attendance records on working days.',
                style: TextStyle(color: Colors.grey.shade600),
              ),
              const SizedBox(height: 12),
              if (_report != null) ...[
                _buildKpiRow(),
                const SizedBox(height: 12),
              ],
              ReportFilterPanel(
                values: _filters,
                showPeriod: false,
                busy: _busy,
                onApply: _apply,
                onReset: () => setState(() {
                  _report = null;
                  _error = null;
                }),
                onExport: _export,
              ),
              const SizedBox(height: 12),
              if (_busy && _report == null)
                const Padding(
                  padding: EdgeInsets.all(48),
                  child: Center(
                    child: Column(
                      children: [
                        CircularProgressIndicator(),
                        SizedBox(height: 16),
                        Text('Checking working days...'),
                      ],
                    ),
                  ),
                ),
              if (_error != null)
                Card(
                  color: Theme.of(context).colorScheme.errorContainer,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Icon(Icons.error_outline,
                            color: Theme.of(context)
                                .colorScheme
                                .onErrorContainer),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            _error!,
                            style: TextStyle(
                                color: Theme.of(context)
                                    .colorScheme
                                    .onErrorContainer),
                          ),
                        ),
                        TextButton(
                            onPressed: _apply, child: const Text('Retry')),
                      ],
                    ),
                  ),
                ),
              ..._buildReport(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildKpiRow() {
    final report = _report!;
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: [
        _KpiCard(
          label: 'Working Days',
          value: '${report['totalWorkingDays'] ?? '-'}',
          icon: Icons.calendar_month,
          color: Colors.indigo,
        ),
        _KpiCard(
          label: 'Users Checked',
          value: '${report['usersCount'] ?? '-'}',
          icon: Icons.people_outline,
          color: Colors.blueGrey,
        ),
        _KpiCard(
          label: 'Total Absences',
          value: '${report['absenceCount'] ?? '-'}',
          icon: Icons.person_off_outlined,
          color: Colors.orange,
        ),
        _KpiCard(
          label: 'Date Range',
          value: '${report['dateFrom']}\n→ ${report['dateTo']}',
          icon: Icons.date_range,
          color: Colors.teal,
          small: true,
        ),
      ],
    );
  }

  List<Widget> _buildReport() {
    final report = _report;
    if (report == null || _busy) return const [];

    final rows = (report['rows'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>();

    if (rows.isEmpty) {
      return [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              children: [
                Icon(Icons.celebration_outlined,
                    size: 48, color: Colors.green.shade400),
                const SizedBox(height: 12),
                const Text(
                  'No absences found for the selected filters.',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                Text(
                  'Everyone with these filters clocked in on every working '
                  'day, or try widening the date range.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey.shade600),
                ),
              ],
            ),
          ),
        ),
      ];
    }

    final byDate = <String, List<Map<String, dynamic>>>{};
    for (final row in rows) {
      final date = row['date']?.toString() ?? '?';
      byDate.putIfAbsent(date, () => []).add(row);
    }
    final dates = byDate.keys.toList()..sort();

    return dates.map((date) {
      final dayRows = byDate[date]!;
      return Card(
        clipBehavior: Clip.antiAlias,
        child: ExpansionTile(
          leading: CircleAvatar(
            backgroundColor: Colors.orange.shade100,
            child: Text(
              '${dayRows.length}',
              style: TextStyle(
                  color: Colors.orange.shade900,
                  fontWeight: FontWeight.bold),
            ),
          ),
          title: Text(date,
              style: const TextStyle(fontWeight: FontWeight.bold)),
          subtitle: Text('${dayRows.length} absent'),
          children: dayRows.map((r) {
            final details = [
              if ((r['employeeCode'] ?? '').toString().isNotEmpty)
                r['employeeCode'],
              r['employeeType'],
              if ((r['position'] ?? '').toString().isNotEmpty) r['position'],
              if ((r['department'] ?? '').toString().isNotEmpty)
                r['department'],
              if ((r['location'] ?? '').toString().isNotEmpty) r['location'],
            ].join(' · ');
            final email = (r['email'] ?? '').toString();
            return ListTile(
              dense: true,
              leading:
                  Icon(Icons.person_off, color: Colors.orange.shade800),
              title: Text(r['fullName']?.toString() ?? 'Unknown'),
              subtitle: Text(
                  '${email.isNotEmpty ? '$email\n' : ''}$details'),
              isThreeLine: email.isNotEmpty,
              trailing: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.red.shade50,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: Colors.red.shade200),
                ),
                child: Text(
                  r['status']?.toString() ?? 'ABSENT',
                  style: TextStyle(
                    color: Colors.red.shade800,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
              ),
            );
          }).toList(),
        ),
      );
    }).toList();
  }
}

class _KpiCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final MaterialColor color;
  final bool small;

  const _KpiCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
    this.small = false,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Container(
        width: 160,
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 18, color: color.shade700),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    label,
                    style: TextStyle(
                        fontSize: 12, color: Colors.grey.shade600),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              value,
              style: TextStyle(
                fontSize: small ? 13 : 22,
                fontWeight: FontWeight.bold,
                color: color.shade800,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
