import 'package:flutter/material.dart';

import '../../models/location_model.dart';
import '../../models/position_model.dart';
import '../../services/api_client.dart';
import '../../services/locations_service.dart';
import '../../services/positions_service.dart';
import '../../services/users_service.dart';

const _roles = ['ADMIN', 'MANAGER', 'EMPLOYEE'];
const _employeeTypes = ['INTERNAL', 'EXTERNAL'];
const _noLocation = '__none__';
const _noPosition = '__none__';

class UserCreateScreen extends StatefulWidget {
  const UserCreateScreen({super.key});

  @override
  State<UserCreateScreen> createState() => _UserCreateScreenState();
}

class _UserCreateScreenState extends State<UserCreateScreen> {
  final _formKey = GlobalKey<FormState>();
  final _usersService = UsersService();
  final _locationsService = LocationsService();
  final _positionsService = PositionsService();

  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _employeeCodeController = TextEditingController();
  final _departmentController = TextEditingController();
  final _phoneController = TextEditingController();
  final _cardUidController = TextEditingController();

  String _role = 'EMPLOYEE';
  String _employeeType = 'INTERNAL';
  String _selectedLocationId = _noLocation;
  String _selectedPositionId = _noPosition;
  bool _requireOtpForCard = false;

  List<LocationModel> _locations = [];
  List<PositionModel> _positions = [];
  bool _loadingLocations = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadLocations();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _employeeCodeController.dispose();
    _departmentController.dispose();
    _phoneController.dispose();
    _cardUidController.dispose();
    super.dispose();
  }

  Future<void> _loadLocations() async {
    try {
      final locations = await _locationsService.getLocations();
      final positions = await _positionsService.getPositions();
      if (mounted) {
        setState(() {
          _locations = locations.where((l) => l.isActive).toList();
          _positions = positions.where((p) => p.isActive).toList();
        });
      }
    } catch (_) {
      // Dropdowns just stay with "No location"/"No position".
    } finally {
      if (mounted) setState(() => _loadingLocations = false);
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await _usersService.createUser(
        fullName: _nameController.text.trim(),
        email: _emailController.text.trim(),
        password: _passwordController.text,
        role: _role,
        employeeCode: _employeeCodeController.text.trim(),
        department: _departmentController.text.trim(),
        phoneNumber: _phoneController.text.trim(),
        cardUid: _cardUidController.text.trim(),
        requireOtpForCard: _requireOtpForCard,
        locationId:
            _selectedLocationId == _noLocation ? null : _selectedLocationId,
        positionId:
            _selectedPositionId == _noPosition ? null : _selectedPositionId,
        employeeType: _employeeType,
      );
      if (!mounted) return;
      final name = result.user.fullName;
      final msg = switch (result.onboardingStatus) {
        'EMAIL_SENT' => 'User "$name" created and welcome email sent.',
        'EMAIL_FAILED' =>
          'User "$name" created, but the welcome email failed. You can resend it from the users list.',
        'ALREADY_ACTIVATED' => 'User "$name" created with a temporary password.',
        'NO_EMAIL' =>
          'User "$name" created without email; no activation email sent.',
        _ => 'User "$name" created.',
      };
      final failed = result.onboardingStatus == 'EMAIL_FAILED';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(msg),
          backgroundColor: failed ? Colors.orange.shade800 : null,
          duration: Duration(seconds: failed ? 6 : 4),
        ),
      );
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Add User')),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                    controller: _nameController,
                    decoration: const InputDecoration(
                      labelText: 'Full name *',
                      border: OutlineInputBorder(),
                    ),
                    validator: (v) => (v == null || v.trim().length < 2)
                        ? 'Enter a full name'
                        : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _emailController,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      labelText: 'Email (optional for card-only users)',
                      border: OutlineInputBorder(),
                    ),
                    validator: (v) {
                      final value = v?.trim() ?? '';
                      if (value.isNotEmpty && !value.contains('@')) {
                        return 'Enter a valid email';
                      }
                      if (value.isEmpty &&
                          _passwordController.text.isNotEmpty) {
                        return 'A password requires an email';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _passwordController,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Password (only for email login users)',
                      border: OutlineInputBorder(),
                    ),
                    validator: (v) {
                      if (v != null && v.isNotEmpty && v.length < 6) {
                        return 'Password must be at least 6 characters';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    initialValue: _role,
                    decoration: const InputDecoration(
                      labelText: 'Role',
                      border: OutlineInputBorder(),
                    ),
                    items: _roles
                        .map((r) => DropdownMenuItem(value: r, child: Text(r)))
                        .toList(),
                    onChanged: (v) => setState(() => _role = v!),
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    initialValue: _employeeType,
                    decoration: const InputDecoration(
                      labelText: 'Employee type',
                      border: OutlineInputBorder(),
                    ),
                    items: _employeeTypes
                        .map((t) => DropdownMenuItem(
                            value: t,
                            child: Text(
                                t == 'INTERNAL' ? 'Internal' : 'External')))
                        .toList(),
                    onChanged: (v) => setState(() => _employeeType = v!),
                  ),
                  const SizedBox(height: 16),
                  if (!_loadingLocations)
                    DropdownButtonFormField<String>(
                      initialValue: _selectedPositionId,
                      decoration: const InputDecoration(
                        labelText: 'Position',
                        border: OutlineInputBorder(),
                      ),
                      items: [
                        const DropdownMenuItem(
                          value: _noPosition,
                          child: Text('No position'),
                        ),
                        ..._positions.map(
                          (p) => DropdownMenuItem(
                              value: p.id, child: Text(p.name)),
                        ),
                      ],
                      onChanged: (v) =>
                          setState(() => _selectedPositionId = v!),
                    ),
                  if (!_loadingLocations) const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: _employeeCodeController,
                          decoration: const InputDecoration(
                            labelText: 'Employee code',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextFormField(
                          controller: _departmentController,
                          decoration: const InputDecoration(
                            labelText: 'Department',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _phoneController,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: 'Phone number (for SMS OTP, e.g. +357...)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _cardUidController,
                    decoration: const InputDecoration(
                      labelText: 'Card UID (RFID/NFC)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  _loadingLocations
                      ? const Center(child: CircularProgressIndicator())
                      : DropdownButtonFormField<String>(
                          initialValue: _selectedLocationId,
                          decoration: const InputDecoration(
                            labelText: 'Assigned location',
                            border: OutlineInputBorder(),
                          ),
                          items: [
                            const DropdownMenuItem(
                              value: _noLocation,
                              child: Text('No location'),
                            ),
                            ..._locations.map(
                              (l) => DropdownMenuItem(
                                  value: l.id, child: Text(l.name)),
                            ),
                          ],
                          onChanged: (v) =>
                              setState(() => _selectedLocationId = v!),
                        ),
                  const SizedBox(height: 8),
                  SwitchListTile(
                    title: const Text('Require OTP for card'),
                    subtitle: const Text(
                        'Ask for an SMS code when clocking in by card'),
                    value: _requireOtpForCard,
                    onChanged: (v) => setState(() => _requireOtpForCard = v),
                  ),
                  const SizedBox(height: 16),
                  if (_error != null) ...[
                    Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style:
                          TextStyle(color: Theme.of(context).colorScheme.error),
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
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Create User'),
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
