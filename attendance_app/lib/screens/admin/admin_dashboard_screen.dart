import 'package:flutter/material.dart';

import '../../services/api_client.dart';
import '../../services/reports_service.dart';
import '../kiosk/kiosk_screen.dart';
import 'absence_reports_screen.dart';
import 'advanced_reports_screen.dart';
import 'locations_admin_screen.dart';
import 'positions_admin_screen.dart';
import 'reports_admin_screen.dart';
import 'users_admin_screen.dart';

class AdminDashboardScreen extends StatelessWidget {
  const AdminDashboardScreen({super.key});

  Future<void> _exportUserTemplate(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    messenger.showSnackBar(
      const SnackBar(content: Text('Downloading user template...')),
    );
    try {
      final savedPath = await ReportsService().exportUsersTemplate();
      messenger.showSnackBar(
        SnackBar(
          content: Text(savedPath == null
              ? 'User template downloaded (users-import-template.xlsx)'
              : 'User template saved to $savedPath'),
        ),
      );
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not download the template.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Admin Dashboard')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 400),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.all(24),
            children: [
              _AdminCard(
                icon: Icons.people_outline,
                title: 'Users',
                subtitle: 'Manage users, roles and assigned locations',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const UsersAdminScreen()),
                ),
              ),
              const SizedBox(height: 16),
              _AdminCard(
                icon: Icons.place_outlined,
                title: 'Locations',
                subtitle: 'Manage work locations and geofence radius',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                      builder: (_) => const LocationsAdminScreen()),
                ),
              ),
              const SizedBox(height: 16),
              _AdminCard(
                icon: Icons.work_outline,
                title: 'Positions',
                subtitle: 'Manage the list of job positions',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                      builder: (_) => const PositionsAdminScreen()),
                ),
              ),
              const SizedBox(height: 16),
              _AdminCard(
                icon: Icons.query_stats,
                title: 'Advanced Reports',
                subtitle:
                    'Filtered attendance with net hours and Excel export',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                      builder: (_) => const AdvancedReportsScreen()),
                ),
              ),
              const SizedBox(height: 16),
              _AdminCard(
                icon: Icons.person_off_outlined,
                title: 'Absence Reports',
                subtitle: 'Who was missing on working days',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                      builder: (_) => const AbsenceReportsScreen()),
                ),
              ),
              const SizedBox(height: 16),
              _AdminCard(
                icon: Icons.bar_chart_outlined,
                title: 'Reports (basic)',
                subtitle: 'Simple daily and monthly reports',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                      builder: (_) => const ReportsAdminScreen()),
                ),
              ),
              const SizedBox(height: 16),
              _AdminCard(
                icon: Icons.file_download_outlined,
                title: 'Export User Template',
                subtitle: 'Download the Excel template for user import',
                onTap: () => _exportUserTemplate(context),
              ),
              const SizedBox(height: 16),
              _AdminCard(
                icon: Icons.contactless_outlined,
                title: 'Kiosk Mode',
                subtitle: 'Reception card-scan kiosk for this device',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const KioskScreen()),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AdminCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _AdminCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.all(16),
        leading: Icon(icon, size: 36),
        title: Text(title,
            style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
