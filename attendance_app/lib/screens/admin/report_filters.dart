import 'package:flutter/material.dart';

import '../../models/location_model.dart';
import '../../services/locations_service.dart';

/// Shared filter state + UI for the advanced and absence report screens.
class ReportFilterValues {
  DateTime dateFrom;
  DateTime dateTo;
  String period; // daily | weekly | monthly (advanced report only)
  String employeeType; // '' = all
  String? locationId; // null = all
  final searchController = TextEditingController();
  final positionController = TextEditingController();
  final departmentController = TextEditingController();

  ReportFilterValues()
      : dateFrom = DateTime.now().subtract(const Duration(days: 6)),
        dateTo = DateTime.now(),
        period = 'daily',
        employeeType = '';

  void reset() {
    dateFrom = DateTime.now().subtract(const Duration(days: 6));
    dateTo = DateTime.now();
    period = 'daily';
    employeeType = '';
    locationId = null;
    searchController.clear();
    positionController.clear();
    departmentController.clear();
  }

  String get dateFromStr => _fmt(dateFrom);
  String get dateToStr => _fmt(dateTo);

  static String _fmt(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  void dispose() {
    searchController.dispose();
    positionController.dispose();
    departmentController.dispose();
  }
}

class ReportFilterPanel extends StatefulWidget {
  final ReportFilterValues values;
  final bool showPeriod;
  final bool busy;
  final VoidCallback onApply;
  final VoidCallback? onReset;
  final void Function(String format) onExport;

  const ReportFilterPanel({
    super.key,
    required this.values,
    required this.showPeriod,
    required this.busy,
    required this.onApply,
    this.onReset,
    required this.onExport,
  });

  @override
  State<ReportFilterPanel> createState() => _ReportFilterPanelState();
}

class _ReportFilterPanelState extends State<ReportFilterPanel> {
  List<LocationModel> _locations = [];

  @override
  void initState() {
    super.initState();
    _loadLocations();
  }

  Future<void> _loadLocations() async {
    try {
      final locations = await LocationsService().getLocations();
      if (mounted) {
        setState(() =>
            _locations = locations.where((l) => l.isActive).toList());
      }
    } catch (_) {
      // Location dropdown just stays on "All locations".
    }
  }

  Future<void> _pickDate({required bool isFrom}) async {
    final v = widget.values;
    final picked = await showDatePicker(
      context: context,
      initialDate: isFrom ? v.dateFrom : v.dateTo,
      firstDate: DateTime(2024),
      lastDate: DateTime.now().add(const Duration(days: 1)),
    );
    if (picked != null) {
      setState(() {
        if (isFrom) {
          v.dateFrom = picked;
          if (v.dateTo.isBefore(v.dateFrom)) v.dateTo = picked;
        } else {
          v.dateTo = picked;
          if (v.dateTo.isBefore(v.dateFrom)) v.dateFrom = picked;
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final v = widget.values;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _pickDate(isFrom: true),
                    icon: const Icon(Icons.calendar_today, size: 16),
                    label: Text('From ${v.dateFromStr}'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => _pickDate(isFrom: false),
                    icon: const Icon(Icons.calendar_today, size: 16),
                    label: Text('To ${v.dateToStr}'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: v.searchController,
              decoration: const InputDecoration(
                labelText: 'Search (name, email, code, position, location)',
                prefixIcon: Icon(Icons.search),
                border: OutlineInputBorder(),
                isDense: true,
              ),
              onSubmitted: (_) => widget.busy ? null : widget.onApply(),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                if (widget.showPeriod) ...[
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: v.period,
                      decoration: const InputDecoration(
                        labelText: 'Period',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      items: const [
                        DropdownMenuItem(value: 'daily', child: Text('Daily')),
                        DropdownMenuItem(
                            value: 'weekly', child: Text('Weekly')),
                        DropdownMenuItem(
                            value: 'monthly', child: Text('Monthly')),
                      ],
                      onChanged: (val) => setState(() => v.period = val!),
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: v.employeeType,
                    decoration: const InputDecoration(
                      labelText: 'Employee type',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    items: const [
                      DropdownMenuItem(value: '', child: Text('All')),
                      DropdownMenuItem(
                          value: 'INTERNAL', child: Text('Internal')),
                      DropdownMenuItem(
                          value: 'EXTERNAL', child: Text('External')),
                    ],
                    onChanged: (val) =>
                        setState(() => v.employeeType = val ?? ''),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: v.positionController,
                    decoration: const InputDecoration(
                      labelText: 'Position',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: v.departmentController,
                    decoration: const InputDecoration(
                      labelText: 'Department',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String?>(
              initialValue: v.locationId,
              decoration: const InputDecoration(
                labelText: 'Location',
                border: OutlineInputBorder(),
                isDense: true,
              ),
              items: [
                const DropdownMenuItem<String?>(
                    value: null, child: Text('All locations')),
                ..._locations.map(
                  (l) => DropdownMenuItem<String?>(
                      value: l.id, child: Text(l.name)),
                ),
              ],
              onChanged: (val) => setState(() => v.locationId = val),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: widget.busy ? null : widget.onApply,
                    icon: widget.busy
                        ? const SizedBox(
                            height: 16,
                            width: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.filter_alt),
                    label: const Text('Apply Filters'),
                  ),
                ),
                if (widget.onReset != null) ...[
                  const SizedBox(width: 8),
                  TextButton.icon(
                    onPressed: widget.busy
                        ? null
                        : () {
                            setState(widget.values.reset);
                            widget.onReset!();
                          },
                    icon: const Icon(Icons.restart_alt, size: 16),
                    label: const Text('Reset'),
                  ),
                ],
                const SizedBox(width: 8),
                OutlinedButton.icon(
                  onPressed:
                      widget.busy ? null : () => widget.onExport('xlsx'),
                  icon: const Icon(Icons.grid_on, size: 16),
                  label: const Text('Export Excel'),
                ),
                const SizedBox(width: 8),
                OutlinedButton.icon(
                  onPressed:
                      widget.busy ? null : () => widget.onExport('csv'),
                  icon: const Icon(Icons.description_outlined, size: 16),
                  label: const Text('Export CSV'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
