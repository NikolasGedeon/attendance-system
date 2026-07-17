import 'package:flutter/material.dart';

import '../../models/location_model.dart';
import '../../services/api_client.dart';
import '../../services/locations_service.dart';
import 'location_edit_screen.dart';

class LocationsAdminScreen extends StatefulWidget {
  const LocationsAdminScreen({super.key});

  @override
  State<LocationsAdminScreen> createState() => _LocationsAdminScreenState();
}

class _LocationsAdminScreenState extends State<LocationsAdminScreen> {
  final _locationsService = LocationsService();

  List<LocationModel> _locations = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadLocations();
  }

  Future<void> _loadLocations() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final locations = await _locationsService.getLocations();
      if (mounted) setState(() => _locations = locations);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openLocation(LocationModel? location) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
          builder: (_) => LocationEditScreen(location: location)),
    );
    if (changed == true) _loadLocations();
  }

  Future<void> _deactivate(LocationModel location) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Deactivate location'),
        content: Text(
            'Deactivate "${location.name}"? Users assigned to it will not '
            'be able to clock in until reassigned.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Deactivate'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      await _locationsService.deactivateLocation(location.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('"${location.name}" deactivated')),
      );
      _loadLocations();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach the server.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Locations'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loading ? null : _loadLocations,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openLocation(null),
        icon: const Icon(Icons.add),
        label: const Text('Add location'),
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _locations.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!,
                  style:
                      TextStyle(color: Theme.of(context).colorScheme.error)),
              const SizedBox(height: 16),
              FilledButton(
                  onPressed: _loadLocations, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadLocations,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
        itemCount: _locations.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (context, index) {
          final location = _locations[index];
          return Card(
            child: ListTile(
              leading: Icon(
                Icons.place,
                color: location.isActive ? Colors.green : Colors.grey,
              ),
              title: Text(
                location.isActive
                    ? location.name
                    : '${location.name} (inactive)',
              ),
              subtitle: Text(
                'Lat: ${location.latitude.toStringAsFixed(6)}\n'
                'Lng: ${location.longitude.toStringAsFixed(6)}\n'
                'Radius: ${location.radiusMeters} m',
              ),
              isThreeLine: true,
              trailing: location.isActive
                  ? IconButton(
                      icon: const Icon(Icons.delete_outline,
                          color: Colors.red),
                      tooltip: 'Deactivate',
                      onPressed: () => _deactivate(location),
                    )
                  : null,
              onTap: () => _openLocation(location),
            ),
          );
        },
      ),
    );
  }
}
