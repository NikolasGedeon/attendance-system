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
        setState(
            () => _locations = locations.where((l) => l.isActive).toList());
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

    final fromField = OutlinedButton.icon(
      onPressed: () => _pickDate(isFrom: true),
      icon: const Icon(Icons.calendar_today, size: 16),
      label: Text('From ${v.dateFromStr}', overflow: TextOverflow.ellipsis),
    );

    final toField = OutlinedButton.icon(
      onPressed: () => _pickDate(isFrom: false),
      icon: const Icon(Icons.calendar_today, size: 16),
      label: Text('To ${v.dateToStr}', overflow: TextOverflow.ellipsis),
    );

    final searchField = TextField(
      controller: v.searchController,
      decoration: const InputDecoration(
        labelText: 'Search (name, email, code, position, location)',
        prefixIcon: Icon(Icons.search),
        border: OutlineInputBorder(),
        isDense: true,
      ),
      onSubmitted: (_) => widget.busy ? null : widget.onApply(),
    );

    final periodField = DropdownButtonFormField<String>(
      initialValue: v.period,
      isExpanded: true,
      decoration: const InputDecoration(
        labelText: 'Period',
        border: OutlineInputBorder(),
        isDense: true,
      ),
      items: const [
        DropdownMenuItem(value: 'daily', child: Text('Daily')),
        DropdownMenuItem(value: 'weekly', child: Text('Weekly')),
        DropdownMenuItem(value: 'monthly', child: Text('Monthly')),
      ],
      onChanged: (val) => setState(() => v.period = val!),
    );

    final typeField = DropdownButtonFormField<String>(
      initialValue: v.employeeType,
      isExpanded: true,
      decoration: const InputDecoration(
        labelText: 'Employee type',
        border: OutlineInputBorder(),
        isDense: true,
      ),
      items: const [
        DropdownMenuItem(value: '', child: Text('All')),
        DropdownMenuItem(value: 'INTERNAL', child: Text('Internal')),
        DropdownMenuItem(value: 'EXTERNAL', child: Text('External')),
      ],
      onChanged: (val) => setState(() => v.employeeType = val ?? ''),
    );

    final positionField = TextField(
      controller: v.positionController,
      decoration: const InputDecoration(
        labelText: 'Position',
        border: OutlineInputBorder(),
        isDense: true,
      ),
    );

    final departmentField = TextField(
      controller: v.departmentController,
      decoration: const InputDecoration(
        labelText: 'Department',
        border: OutlineInputBorder(),
        isDense: true,
      ),
    );

    final locationField = DropdownButtonFormField<String?>(
      initialValue: v.locationId,
      isExpanded: true,
      decoration: const InputDecoration(
        labelText: 'Location',
        border: OutlineInputBorder(),
        isDense: true,
      ),
      items: [
        const DropdownMenuItem<String?>(
            value: null, child: Text('All locations')),
        ..._locations.map(
          (l) => DropdownMenuItem<String?>(value: l.id, child: Text(l.name)),
        ),
      ],
      onChanged: (val) => setState(() => v.locationId = val),
    );

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: LayoutBuilder(
          builder: (context, constraints) {
            // On narrow widths (phone portrait, and small landscape) paired
            // controls stack vertically and the action buttons wrap, so the
            // panel never overflows horizontally. At/above the breakpoint the
            // original two-across / single-row layout is preserved unchanged
            // for tablet, web and desktop.
            final narrow = constraints.maxWidth < 560;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _pair(fromField, toField, narrow),
                const SizedBox(height: 12),
                searchField,
                const SizedBox(height: 12),
                if (widget.showPeriod)
                  _pair(periodField, typeField, narrow)
                else
                  typeField,
                const SizedBox(height: 12),
                _pair(positionField, departmentField, narrow),
                const SizedBox(height: 12),
                locationField,
                const SizedBox(height: 16),
                _buildActions(narrow),
              ],
            );
          },
        ),
      ),
    );
  }

  /// Two controls side by side on wide screens, stacked on narrow ones.
  Widget _pair(Widget a, Widget b, bool narrow) {
    if (narrow) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [a, const SizedBox(height: 12), b],
      );
    }
    return Row(
      children: [
        Expanded(child: a),
        const SizedBox(width: 8),
        Expanded(child: b),
      ],
    );
  }

  Widget _buildActions(bool narrow) {
    final applyButton = FilledButton.icon(
      onPressed: widget.busy ? null : widget.onApply,
      icon: widget.busy
          ? const SizedBox(
              height: 16,
              width: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.filter_alt),
      label: const Text('Apply Filters'),
    );

    final resetButton = widget.onReset == null
        ? null
        : TextButton.icon(
            onPressed: widget.busy
                ? null
                : () {
                    setState(widget.values.reset);
                    widget.onReset!();
                  },
            icon: const Icon(Icons.restart_alt, size: 16),
            label: const Text('Reset'),
          );

    final exportExcel = OutlinedButton.icon(
      onPressed: widget.busy ? null : () => widget.onExport('xlsx'),
      icon: const Icon(Icons.grid_on, size: 16),
      label: const Text('Export Excel'),
    );

    final exportCsv = OutlinedButton.icon(
      onPressed: widget.busy ? null : () => widget.onExport('csv'),
      icon: const Icon(Icons.description_outlined, size: 16),
      label: const Text('Export CSV'),
    );

    if (narrow) {
      // Full-width primary action; secondary actions wrap onto extra rows
      // while keeping their normal (readable, tappable) size.
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(width: double.infinity, child: applyButton),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (resetButton != null) resetButton,
              exportExcel,
              exportCsv,
            ],
          ),
        ],
      );
    }

    // Wide layout: unchanged from the original horizontal row.
    return Row(
      children: [
        Expanded(child: applyButton),
        if (resetButton != null) ...[
          const SizedBox(width: 8),
          resetButton,
        ],
        const SizedBox(width: 8),
        exportExcel,
        const SizedBox(width: 8),
        exportCsv,
      ],
    );
  }
}
