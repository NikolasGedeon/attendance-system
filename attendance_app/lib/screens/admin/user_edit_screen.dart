import 'package:flutter/material.dart';

import '../../models/location_model.dart';
import '../../models/position_model.dart';
import '../../models/user_model.dart';
import '../../services/api_client.dart';
import '../../services/locations_service.dart';
import '../../services/positions_service.dart';
import '../../services/users_service.dart';

const _roles = ['ADMIN', 'MANAGER', 'EMPLOYEE'];
const _employeeTypes = ['INTERNAL', 'EXTERNAL'];

/// Sentinel value for "none" in dropdowns.
const _none = '__none__';

class UserEditScreen extends StatefulWidget {
  final UserModel user;

  const UserEditScreen({super.key, required this.user});

  @override
  State<UserEditScreen> createState() => _UserEditScreenState();
}

class _UserEditScreenState extends State<UserEditScreen> {
  final _formKey = GlobalKey<FormState>();
  final _usersService = UsersService();
  final _locationsService = LocationsService();
  final _positionsService = PositionsService();

  late final TextEditingController _nameController =
      TextEditingController(text: widget.user.fullName);
  late final TextEditingController _emailController =
      TextEditingController(text: widget.user.email);
  late final TextEditingController _employeeCodeController =
      TextEditingController(text: widget.user.employeeCode ?? '');
  late final TextEditingController _departmentController =
      TextEditingController(text: widget.user.department ?? '');
  late final TextEditingController _phoneController =
      TextEditingController(text: widget.user.phoneNumber ?? '');
  late final TextEditingController _cardUidController =
      TextEditingController(text: widget.user.cardUid ?? '');

  late String _role = widget.user.role;
  late bool _isActive = widget.user.isActive;
  late bool _requireOtpForCard = widget.user.requireOtpForCard;
  late String _employeeType = widget.user.employeeType;
  late String _selectedLocationId = widget.user.locationId ?? _none;
  late String _selectedPositionId = widget.user.positionId ?? _none;

  List<LocationModel> _locations = [];
  List<PositionModel> _positions = [];
  bool _loadingLists = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadLists();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _employeeCodeController.dispose();
    _departmentController.dispose();
    _phoneController.dispose();
    _cardUidController.dispose();
    super.dispose();
  }

  Future<void> _loadLists() async {
    try {
      final locations = await _locationsService.getLocations();
      final positions = await _positionsService.getPositions();
      if (mounted) {
        setState(() {
          // Active entries, plus the user's current one even if inactive.
          _locations = locations
              .where((l) => l.isActive || l.id == widget.user.locationId)
              .toList();
          _positions = positions
              .where((p) => p.isActive || p.id == widget.user.positionId)
              .toList();
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load lists.');
    } finally {
      if (mounted) setState(() => _loadingLists = false);
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await _usersService.updateUser(
        widget.user.id,
        fullName: _nameController.text.trim(),
        email: _emailController.text.trim(),
        role: _role,
        isActive: _isActive,
        locationId: _selectedLocationId == _none ? null : _selectedLocationId,
        positionId: _selectedPositionId == _none ? null : _selectedPositionId,
        employeeType: _employeeType,
        employeeCode: _employeeCodeController.text.trim(),
        department: _departmentController.text.trim(),
        phoneNumber: _phoneController.text.trim(),
        cardUid: _cardUidController.text.trim(),
        requireOtpForCard: _requireOtpForCard,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('User updated successfully')),
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
      appBar: AppBar(title: Text('Edit ${widget.user.fullName}')),
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
                      labelText: 'Email (empty for card-only users)',
                      border: OutlineInputBorder(),
                    ),
                    validator: (v) {
                      final value = v?.trim() ?? '';
                      if (value.isNotEmpty && !value.contains('@')) {
                        return 'Enter a valid email';
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
                  if (_loadingLists)
                    const Center(child: CircularProgressIndicator())
                  else ...[
                    DropdownButtonFormField<String>(
                      initialValue: _selectedPositionId,
                      decoration: const InputDecoration(
                        labelText: 'Position',
                        border: OutlineInputBorder(),
                      ),
                      items: [
                        const DropdownMenuItem(
                          value: _none,
                          child: Text('No position'),
                        ),
                        ..._positions.map(
                          (p) => DropdownMenuItem(
                            value: p.id,
                            child: Text(
                                p.isActive ? p.name : '${p.name} (inactive)'),
                          ),
                        ),
                      ],
                      onChanged: (v) =>
                          setState(() => _selectedPositionId = v!),
                    ),
                    const SizedBox(height: 16),
                    DropdownButtonFormField<String>(
                      initialValue: _selectedLocationId,
                      decoration: const InputDecoration(
                        labelText: 'Assigned location',
                        border: OutlineInputBorder(),
                      ),
                      items: [
                        const DropdownMenuItem(
                          value: _none,
                          child: Text('No location'),
                        ),
                        ..._locations.map(
                          (l) => DropdownMenuItem(
                            value: l.id,
                            child: Text(
                                l.isActive ? l.name : '${l.name} (inactive)'),
                          ),
                        ),
                      ],
                      onChanged: (v) =>
                          setState(() => _selectedLocationId = v!),
                    ),
                  ],
                  const SizedBox(height: 8),
                  SwitchListTile(
                    title: const Text('Require OTP for card'),
                    subtitle: const Text(
                        'Ask for an SMS code when clocking in by card'),
                    value: _requireOtpForCard,
                    onChanged: (v) => setState(() => _requireOtpForCard = v),
                  ),
                  SwitchListTile(
                    title: const Text('Active'),
                    subtitle: const Text('Inactive users cannot use the app'),
                    value: _isActive,
                    onChanged: (v) => setState(() => _isActive = v),
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
                        : const Text('Save'),
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
