import 'package:flutter/material.dart';

import '../../services/api_client.dart';
import '../../services/reports_service.dart';
import 'report_filters.dart';

class AdvancedReportsScreen extends StatefulWidget {
  const AdvancedReportsScreen({super.key});

  @override
  State<AdvancedReportsScreen> createState() => _AdvancedReportsScreenState();
}

class _AdvancedReportsScreenState extends State<AdvancedReportsScreen> {
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
      final report = await _reportsService.getAdvancedReport(
        dateFrom: _filters.dateFromStr,
        dateTo: _filters.dateToStr,
        period: _filters.period,
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
      final savedPath = await _reportsService.exportAdvancedReport(
        dateFrom: _filters.dateFromStr,
        dateTo: _filters.dateToStr,
        period: _filters.period,
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
              ? 'Report downloaded (${format.toUpperCase()})'
              : 'Report saved to $savedPath'),
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
      appBar: AppBar(title: const Text('Advanced Attendance Reports')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 860),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildHeader(),
              const SizedBox(height: 12),
              if (_report != null) ...[
                _buildKpiRow(),
                const SizedBox(height: 12),
              ],
              ReportFilterPanel(
                values: _filters,
                showPeriod: true,
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
                        Text('Building report...'),
                      ],
                    ),
                  ),
                ),
              if (_error != null) _buildErrorCard(),
              ..._buildReport(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Advanced Attendance Reports',
          style: Theme.of(context)
              .textTheme
              .headlineSmall
              ?.copyWith(fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 4),
        Text(
          'Review employee attendance, working hours, breaks, and totals.',
          style: TextStyle(color: Colors.grey.shade600),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Icon(Icons.date_range, size: 16, color: Colors.grey.shade700),
            const SizedBox(width: 6),
            Text(
              '${_filters.dateFromStr}  →  ${_filters.dateToStr}'
              '${_report != null ? '   ·   ${_report!['period']}' : ''}',
              style: TextStyle(
                  color: Colors.grey.shade700, fontWeight: FontWeight.w500),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildKpiRow() {
    final report = _report!;
    final grand = report['grandTotal'] as Map<String, dynamic>? ?? {};
    final users = (report['users'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>();

    var openRecords = 0;
    for (final u in users) {
      for (final d in (u['days'] as List<dynamic>? ?? [])) {
        if ((d as Map<String, dynamic>)['hasOpenRecord'] == true) {
          openRecords++;
        }
      }
    }

    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: [
        _KpiCard(
          label: 'Total Users',
          value: '${report['usersCount'] ?? users.length}',
          icon: Icons.people_outline,
          color: Colors.indigo,
        ),
        _KpiCard(
          label: 'Gross Hours',
          value: '${grand['grossHours'] ?? 0}',
          icon: Icons.schedule,
          color: Colors.blueGrey,
        ),
        _KpiCard(
          label: 'Break Hours',
          value: '${grand['breakHours'] ?? 0}',
          icon: Icons.free_breakfast_outlined,
          color: Colors.orange,
        ),
        _KpiCard(
          label: 'Net Hours',
          value: '${grand['netHours'] ?? 0}',
          icon: Icons.check_circle_outline,
          color: Colors.green,
        ),
        _KpiCard(
          label: 'Open Records',
          value: '$openRecords',
          icon: Icons.warning_amber_outlined,
          color: openRecords > 0 ? Colors.red : Colors.grey,
        ),
      ],
    );
  }

  Widget _buildErrorCard() {
    return Card(
      color: Theme.of(context).colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(Icons.error_outline,
                color: Theme.of(context).colorScheme.onErrorContainer),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                _error!,
                style: TextStyle(
                    color: Theme.of(context).colorScheme.onErrorContainer),
              ),
            ),
            TextButton(onPressed: _apply, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildReport() {
    final report = _report;
    if (report == null || _busy) return const [];

    final users = (report['users'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>();

    if (users.isEmpty) {
      return [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              children: [
                Icon(Icons.search_off, size: 48, color: Colors.grey.shade400),
                const SizedBox(height: 12),
                const Text(
                  'No attendance records found for the selected filters.',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                Text(
                  'Try adjusting the date range, clearing the search field, '
                  'or removing the position/department/location filters.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey.shade600),
                ),
              ],
            ),
          ),
        ),
      ];
    }

    return users.map(_buildUserCard).toList();
  }

  Widget _buildUserCard(Map<String, dynamic> entry) {
    final user = entry['user'] as Map<String, dynamic>? ?? {};
    final days =
        (entry['days'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
    final weeks =
        (entry['weeks'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
    final months =
        (entry['months'] as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
    final totals = entry['totals'] as Map<String, dynamic>? ?? {};
    final period = _report?['period']?.toString() ?? 'daily';

    String chip(String? v) => (v ?? '').toString();
    final metaChips = <String>[
      if (chip(user['employeeCode']).isNotEmpty) chip(user['employeeCode']),
      chip(user['employeeType']),
      if (chip(user['position']).isNotEmpty) chip(user['position']),
      if (chip(user['department']).isNotEmpty) chip(user['department']),
      if (chip(user['location']).isNotEmpty) chip(user['location']),
    ];

    return Card(
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        title: Text(
          user['fullName']?.toString() ?? 'Unknown',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Wrap(
            spacing: 6,
            runSpacing: 4,
            children: metaChips
                .map((m) => Chip(
                      label: Text(m, style: const TextStyle(fontSize: 11)),
                      visualDensity: VisualDensity.compact,
                      materialTapTargetSize:
                          MaterialTapTargetSize.shrinkWrap,
                      padding: EdgeInsets.zero,
                    ))
                .toList(),
          ),
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              '${totals['netHours'] ?? '-'} h',
              style: const TextStyle(
                  fontWeight: FontWeight.bold, fontSize: 16),
            ),
            Text('net total',
                style:
                    TextStyle(fontSize: 11, color: Colors.grey.shade600)),
          ],
        ),
        children: [
          Container(
            color: Colors.grey.shade100,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: _row(
              const ['Date', 'Clock In', 'Clock Out', 'Gross', 'Break', 'Net',
                'Status'],
              bold: true,
              color: Colors.grey.shade700,
            ),
          ),
          ...days.asMap().entries.map((e) {
            final d = e.value;
            final open = d['hasOpenRecord'] == true;
            return Container(
              color: e.key.isOdd ? Colors.grey.shade50 : null,
              padding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: _row([
                d['date']?.toString() ?? '',
                d['clockIn']?.toString() ?? '—',
                d['clockOut']?.toString() ?? (open ? 'OPEN' : '—'),
                '${d['grossHours'] ?? '-'}',
                '${d['breakHours'] ?? '-'}',
                '${d['netHours'] ?? '-'}',
                open
                    ? 'OPEN RECORD'
                    : ((d['recordsCount'] ?? 1) as num) > 1
                        ? '${d['recordsCount']} records'
                        : '',
              ], statusColor: open ? Colors.red.shade700 : null),
            );
          }),
          Container(
            width: double.infinity,
            color: Colors.indigo.shade50,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Column(
              children: [
                if (period == 'weekly' || period == 'monthly')
                  ...weeks.map((w) => _row([
                        '${w['key']}',
                        '',
                        '${w['daysWorked'] ?? '-'} day(s)',
                        '${w['grossHours'] ?? '-'}',
                        '${w['breakHours'] ?? '-'}',
                        '${w['netHours'] ?? '-'}',
                        '',
                      ], bold: true)),
                if (period == 'monthly')
                  ...months.map((m) => _row([
                        'Month ${m['key']}',
                        '',
                        '${m['daysWorked'] ?? '-'} day(s)',
                        '${m['grossHours'] ?? '-'}',
                        '${m['breakHours'] ?? '-'}',
                        '${m['netHours'] ?? '-'}',
                        '',
                      ], bold: true)),
                _row([
                  'USER TOTAL',
                  '',
                  '${totals['daysWorked'] ?? '-'} day(s)',
                  '${totals['grossHours'] ?? '-'}',
                  '${totals['breakHours'] ?? '-'}',
                  '${totals['netHours'] ?? '-'}',
                  '',
                ], bold: true),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(
    List<String> cells, {
    bool bold = false,
    Color? color,
    Color? statusColor,
  }) {
    final style = TextStyle(
      fontWeight: bold ? FontWeight.bold : null,
      fontSize: 12.5,
      color: color,
    );
    return Row(
      children: [
        Expanded(flex: 4, child: Text(cells[0], style: style)),
        Expanded(flex: 2, child: Text(cells[1], style: style)),
        Expanded(flex: 3, child: Text(cells[2], style: style)),
        Expanded(
            flex: 2,
            child: Text(cells[3], style: style, textAlign: TextAlign.right)),
        Expanded(
            flex: 2,
            child: Text(cells[4], style: style, textAlign: TextAlign.right)),
        Expanded(
            flex: 2,
            child: Text(cells[5], style: style, textAlign: TextAlign.right)),
        Expanded(
          flex: 3,
          child: Text(
            cells[6],
            textAlign: TextAlign.right,
            style: style.copyWith(
              color: statusColor ?? style.color,
              fontWeight: statusColor != null ? FontWeight.bold : null,
            ),
          ),
        ),
      ],
    );
  }
}

class _KpiCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final MaterialColor color;

  const _KpiCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Container(
        width: 150,
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
                fontSize: 22,
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
