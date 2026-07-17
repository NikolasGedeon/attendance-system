import 'package:flutter/material.dart';

import '../../models/location_model.dart';
import '../../services/api_client.dart';
import '../../services/locations_service.dart';

/// Create (location == null) or edit an existing location.
class LocationEditScreen extends StatefulWidget {
  final LocationModel? location;

  const LocationEditScreen({super.key, this.location});

  @override
  State<LocationEditScreen> createState() => _LocationEditScreenState();
}

class _LocationEditScreenState extends State<LocationEditScreen> {
  final _formKey = GlobalKey<FormState>();
  final _locationsService = LocationsService();

  late final TextEditingController _nameController =
      TextEditingController(text: widget.location?.name ?? '');
  late final TextEditingController _latController = TextEditingController(
      text: widget.location?.latitude.toString() ?? '');
  late final TextEditingController _lngController = TextEditingController(
      text: widget.location?.longitude.toString() ?? '');
  late final TextEditingController _radiusController = TextEditingController(
      text: (widget.location?.radiusMeters ?? 150).toString());

  late bool _isActive = widget.location?.isActive ?? true;

  bool _saving = false;
  String? _error;

  bool get _isEdit => widget.location != null;

  @override
  void dispose() {
    _nameController.dispose();
    _latController.dispose();
    _lngController.dispose();
    _radiusController.dispose();
    super.dispose();
  }

  String? _validateNumber(String? v, String label, double min, double max) {
    final parsed = double.tryParse(v ?? '');
    if (parsed == null) return 'Enter a valid $label';
    if (parsed < min || parsed > max) {
      return '$label must be between $min and $max';
    }
    return null;
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _saving = true;
      _error = null;
    });

    final name = _nameController.text.trim();
    final latitude = double.parse(_latController.text.trim());
    final longitude = double.parse(_lngController.text.trim());
    final radiusMeters = int.parse(_radiusController.text.trim());

    try {
      if (_isEdit) {
        await _locationsService.updateLocation(
          widget.location!.id,
          name: name,
          latitude: latitude,
          longitude: longitude,
          radiusMeters: radiusMeters,
          isActive: _isActive,
        );
      } else {
        await _locationsService.createLocation(
          name: name,
          latitude: latitude,
          longitude: longitude,
          radiusMeters: radiusMeters,
        );
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content:
                Text(_isEdit ? 'Location updated' : 'Location created')),
      );
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? 'Edit ${widget.location!.name}' : 'Add location'),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                    controller: _nameController,
                    decoration: const InputDecoration(
                      labelText: 'Name',
                      border: OutlineInputBorder(),
                    ),
                    validator: (v) => (v == null || v.trim().length < 2)
                        ? 'Enter a location name'
                        : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _latController,
                    keyboardType: const TextInputType.numberWithOptions(
                        decimal: true, signed: true),
                    decoration: const InputDecoration(
                      labelText: 'Latitude',
                      border: OutlineInputBorder(),
                    ),
                    validator: (v) =>
                        _validateNumber(v, 'latitude', -90, 90),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _lngController,
                    keyboardType: const TextInputType.numberWithOptions(
                        decimal: true, signed: true),
                    decoration: const InputDecoration(
                      labelText: 'Longitude',
                      border: OutlineInputBorder(),
                    ),
                    validator: (v) =>
                        _validateNumber(v, 'longitude', -180, 180),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _radiusController,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Radius (meters)',
                      border: OutlineInputBorder(),
                    ),
                    validator: (v) {
                      final parsed = int.tryParse(v ?? '');
                      if (parsed == null || parsed < 10 || parsed > 10000) {
                        return 'Radius must be between 10 and 10000 meters';
                      }
                      return null;
                    },
                  ),
                  if (_isEdit) ...[
                    const SizedBox(height: 16),
                    SwitchListTile(
                      title: const Text('Active'),
                      value: _isActive,
                      onChanged: (v) => setState(() => _isActive = v),
                    ),
                  ],
                  const SizedBox(height: 16),
                  if (_error != null) ...[
                    Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          color: Theme.of(context).colorScheme.error),
                    ),
                    const SizedBox(height: 16),
                  ],
                  FilledButton(
                    onPressed: _saving ? null : _save,
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                    ),
                    child: _saving
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child:
                                CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(_isEdit ? 'Save' : 'Create'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
