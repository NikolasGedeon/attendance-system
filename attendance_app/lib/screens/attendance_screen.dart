import 'package:flutter/material.dart';

import '../config/feature_flags.dart';
import '../models/attendance_status.dart';
import '../models/user_model.dart';
import '../services/api_client.dart';
import '../services/attendance_service.dart';
import '../services/auth_service.dart';
import '../services/location_service.dart';
import 'admin/admin_dashboard_screen.dart';
import 'login_screen.dart';
import 'mobile/mobile_token_screen.dart';
import 'mobile/scan_kiosk_qr_screen.dart';

class AttendanceScreen extends StatefulWidget {
  final UserModel user;

  const AttendanceScreen({super.key, required this.user});

  @override
  State<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends State<AttendanceScreen> {
  final _attendanceService = AttendanceService();
  final _locationService = LocationService();

  AttendanceStatus? _status;
  bool _loading = true;
  bool _actionInProgress = false;
  String? _error;
  String? _success;

  @override
  void initState() {
    super.initState();
    _loadStatus();
  }

  Future<void> _loadStatus() async {
    setState(() {
      _loading = true;
      _error = null;
      _success = null;
    });
    try {
      final status = await _attendanceService.getStatus();
      if (!mounted) return;
      setState(() => _status = status);
    } on ApiException catch (e) {
      if (e.statusCode == 401) {
        _logout();
        return;
      }
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Clock In: get GPS position first, then send coordinates to the backend.
  Future<void> _clockIn() async {
    setState(() {
      _actionInProgress = true;
      _error = null;
      _success = null;
    });
    try {
      final position = await _locationService.getCurrentPosition();
      final locationName = await _attendanceService.clockIn(
        position.latitude,
        position.longitude,
      );
      if (mounted) {
        setState(() => _success = locationName != null
            ? 'Clocked in successfully at $locationName'
            : 'Clocked in successfully');
      }
    } on LocationException catch (e) {
      if (mounted) setState(() => _error = e.message);
      if (mounted) setState(() => _actionInProgress = false);
      return; // no server call happened; keep current status
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _actionInProgress = false);
    }
    await _refreshKeepingMessages();
  }

  Future<void> _clockOut() async {
    setState(() {
      _actionInProgress = true;
      _error = null;
      _success = null;
    });
    try {
      await _attendanceService.clockOut();
      if (mounted) setState(() => _success = 'Clocked out successfully');
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _actionInProgress = false);
    }
    await _refreshKeepingMessages();
  }

  /// Reload status without wiping the success/error message just set.
  Future<void> _refreshKeepingMessages() async {
    final error = _error;
    final success = _success;
    await _loadStatus();
    if (mounted) {
      setState(() {
        _error ??= error;
        _success = success;
      });
    }
  }

  Future<void> _logout() async {
    await AuthService().logout();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  }

  String _formatTime(DateTime dt) {
    final local = dt.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)}/${local.year} '
        '${two(local.hour)}:${two(local.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Attendance'),
        actions: [
          if (widget.user.isAdminOrManager)
            IconButton(
              icon: const Icon(Icons.admin_panel_settings),
              tooltip: 'Admin',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const AdminDashboardScreen()),
              ),
            ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loading ? null : _loadStatus,
            tooltip: 'Refresh',
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: _logout,
            tooltip: 'Log out',
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadStatus,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(24),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: _buildBody(),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading && _status == null) {
      return const Padding(
        padding: EdgeInsets.only(top: 120),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    final status = _status;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 8),
        Text(
          'Hello, ${widget.user.fullName}',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 24),
        if (_error != null)
          Card(
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
                          color:
                              Theme.of(context).colorScheme.onErrorContainer),
                    ),
                  ),
                ],
              ),
            ),
          ),
        if (_success != null)
          Card(
            color: Colors.green.shade50,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(Icons.check_circle_outline,
                      color: Colors.green.shade700),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      _success!,
                      style: TextStyle(
                        color: Colors.green.shade700,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        if (status != null) ...[
          if (status.forceClockOut)
            Card(
              color: Colors.red.shade50,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Icon(Icons.warning_amber_rounded,
                        color: Colors.red.shade700),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        status.message,
                        style: TextStyle(
                          color: Colors.red.shade700,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            )
          else
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text(status.message),
              ),
            ),
          const SizedBox(height: 16),
          if (status.attendance?.clockIn != null)
            ListTile(
              leading: const Icon(Icons.login),
              title: const Text('Clocked in at'),
              subtitle: Text(_formatTime(status.attendance!.clockIn!)),
            ),
          if (status.hoursOpen != null)
            ListTile(
              leading: const Icon(Icons.timer_outlined),
              title: const Text('Hours open'),
              subtitle: Text(status.hoursOpen!.toStringAsFixed(2)),
            ),
          const SizedBox(height: 24),
          if (status.canClockIn && !status.forceClockOut)
            FilledButton.icon(
              onPressed: _actionInProgress ? null : _clockIn,
              icon: const Icon(Icons.login),
              label: const Text('Clock In'),
              style: FilledButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),
          if (status.isClockedIn)
            FilledButton.icon(
              onPressed: _actionInProgress ? null : _clockOut,
              icon: const Icon(Icons.logout),
              label: const Text('Clock Out'),
              style: FilledButton.styleFrom(
                backgroundColor:
                    status.forceClockOut ? Colors.red.shade700 : null,
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),
          if (_actionInProgress) ...[
            const SizedBox(height: 16),
            const Center(child: CircularProgressIndicator()),
          ],
          if (enableKioskDisplayedQr) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () async {
                final clocked = await Navigator.of(context).push<bool>(
                  MaterialPageRoute(builder: (_) => const ScanKioskQrScreen()),
                );
                // The scan may have clocked in/out — refresh the status.
                if (clocked == true && mounted) _loadStatus();
              },
              icon: const Icon(Icons.qr_code_scanner),
              label: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Scan Kiosk QR'),
                  Text(
                    'Scan the QR code shown on the attendance kiosk',
                    style: TextStyle(fontSize: 11),
                  ),
                ],
              ),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),
          ],
          if (enableLegacyEmployeeQrDisplay) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const MobileTokenScreen()),
              ),
              icon: const Icon(Icons.qr_code_2),
              label: const Text('Send Token to Scanner'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),
          ],
        ],
      ],
    );
  }
}
