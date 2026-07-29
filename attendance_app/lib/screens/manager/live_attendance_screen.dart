import 'dart:async';

import 'package:flutter/material.dart';

import '../../services/api_client.dart';
import '../../services/manager_service.dart';

/// Manager-only live attendance. Polls the backend every 12s. The only action
/// a manager can take here is a clock-in override, and ONLY when the backend
/// says `managerClockInAvailable == true` (3+ failed clock-in attempts). The
/// backend re-verifies eligibility, scope and reason on submit — the UI is not
/// trusted.
class LiveAttendanceScreen extends StatefulWidget {
  const LiveAttendanceScreen({super.key});

  @override
  State<LiveAttendanceScreen> createState() => _LiveAttendanceScreenState();
}

class _LiveAttendanceScreenState extends State<LiveAttendanceScreen> {
  final ManagerService _service = ManagerService();
  static const _pollInterval = Duration(seconds: 12);

  Timer? _timer;
  bool _loading = true;
  String? _error;
  List<LiveAttendanceRow> _rows = const [];

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(_pollInterval, (_) => _load(silent: true));
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);
    try {
      final rows = await _service.getLiveAttendance();
      if (!mounted) return;
      setState(() {
        _rows = rows;
        _error = null;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  String _time(DateTime? t) {
    if (t == null) return '—';
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(t.hour)}:${two(t.minute)}';
  }

  Future<void> _openOverrideDialog(LiveAttendanceRow row) async {
    final reasonController = TextEditingController();
    final formKey = GlobalKey<FormState>();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Clock in employee'),
        content: SingleChildScrollView(
          child: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(row.employeeName,
                    style: const TextStyle(fontWeight: FontWeight.bold)),
                if (row.assignedLocation != null)
                  Text('Assigned: ${row.assignedLocation}'),
                const SizedBox(height: 8),
                Text('Failed clock-in attempts: ${row.failedClockInAttempts}'),
                const SizedBox(height: 12),
                TextFormField(
                  controller: reasonController,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: 'Reason (required)',
                    hintText: 'Why are you clocking this employee in?',
                    border: OutlineInputBorder(),
                  ),
                  validator: (v) => (v == null || v.trim().length < 3)
                      ? 'Please enter a reason (min 3 characters)'
                      : null,
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (formKey.currentState?.validate() ?? false) {
                Navigator.of(ctx).pop(true);
              }
            },
            child: const Text('Confirm clock-in'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    if (!mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await _service.clockInEmployee(row.employeeId, reasonController.text.trim());
      messenger.showSnackBar(
        SnackBar(content: Text('${row.employeeName} clocked in.')),
      );
      await _load(silent: true);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not reach the server.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Live Attendance'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: _loading ? null : () => _load(),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => _load(),
        child: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading && _rows.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _rows.isEmpty) {
      return ListView(
        children: [
          const SizedBox(height: 120),
          Center(child: Text(_error!)),
          const SizedBox(height: 12),
          Center(
            child: OutlinedButton(
              onPressed: () => _load(),
              child: const Text('Retry'),
            ),
          ),
        ],
      );
    }
    if (_rows.isEmpty) {
      return ListView(
        children: const [
          SizedBox(height: 120),
          Center(child: Text('No employees in your scope right now.')),
        ],
      );
    }

    return ListView.separated(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(12),
      itemCount: _rows.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, i) => _buildCard(_rows[i]),
    );
  }

  Widget _buildCard(LiveAttendanceRow row) {
    final clockedIn = row.isClockedIn;
    final statusColor = clockedIn ? Colors.green : Colors.grey;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.circle, size: 12, color: statusColor),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    row.employeeName,
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                ),
                Text(
                  clockedIn ? 'Clocked in' : 'Clocked out',
                  style: TextStyle(color: statusColor),
                ),
              ],
            ),
            const SizedBox(height: 6),
            _kv('Assigned workplace', row.assignedLocation ?? '—'),
            _kv('Clock-in', _time(row.clockInTime)),
            if (row.clockOutTime != null) _kv('Clock-out', _time(row.clockOutTime)),
            _kv('Actual clock-in location', row.actualClockInLocation ?? '—'),
            if (row.actualClockOutLocation != null)
              _kv('Actual clock-out location', row.actualClockOutLocation!),
            _kv(
              'Method / kiosk',
              [
                if (row.clockInMethod != null) row.clockInMethod,
                if (row.clockInKiosk != null) '· ${row.clockInKiosk}',
              ].whereType<String>().join(' ').trim().isEmpty
                  ? '—'
                  : [
                      if (row.clockInMethod != null) row.clockInMethod,
                      if (row.clockInKiosk != null) '· ${row.clockInKiosk}',
                    ].whereType<String>().join(' '),
            ),
            _kv('Failed clock-in attempts', '${row.failedClockInAttempts}'),
            if (row.managerClockInAvailable) ...[
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  icon: const Icon(Icons.login),
                  label: const Text('Clock In Employee'),
                  onPressed: () => _openOverrideDialog(row),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _kv(String k, String v) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 170,
            child: Text(k, style: const TextStyle(color: Colors.black54)),
          ),
          Expanded(child: Text(v)),
        ],
      ),
    );
  }
}
