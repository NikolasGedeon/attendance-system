import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../models/user_model.dart';
import '../../services/api_client.dart';
import '../../services/users_service.dart';
import 'user_create_screen.dart';
import 'user_edit_screen.dart';

class UsersAdminScreen extends StatefulWidget {
  const UsersAdminScreen({super.key});

  @override
  State<UsersAdminScreen> createState() => _UsersAdminScreenState();
}

class _UsersAdminScreenState extends State<UsersAdminScreen> {
  final _usersService = UsersService();

  List<UserModel> _users = [];
  bool _loading = true;
  String? _error;
  String _statusFilter = 'active'; // active | inactive | all
  final Set<String> _selected = {};

  @override
  void initState() {
    super.initState();
    _loadUsers();
  }

  Future<void> _loadUsers() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final users = await _usersService.getUsers(status: _statusFilter);
      if (mounted) {
        setState(() {
          _users = users;
          _selected.removeWhere((id) => !users.any((u) => u.id == id));
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openUser(UserModel user) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => UserEditScreen(user: user)),
    );
    if (changed == true) _loadUsers();
  }

  Future<void> _addUser() async {
    final created = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const UserCreateScreen()),
    );
    if (created == true) _loadUsers();
  }

  // -------------------------------------------------------------------
  // Delete / deactivate
  // -------------------------------------------------------------------

  /// Returns null (cancelled), false (deactivate) or true (permanent).
  Future<bool?> _confirmDelete(int count) async {
    var permanent = false;
    return showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(count == 1 ? 'Delete user' : 'Delete $count users'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Deactivate: the users can no longer use the app, but their '
                'attendance history remains for reports.',
              ),
              const SizedBox(height: 12),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                value: permanent,
                onChanged: (v) =>
                    setDialogState(() => permanent = v == true),
                title: const Text(
                  'Delete permanently',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                subtitle: const Text(
                  'Removes the user AND all their attendance records from '
                  'the database. This cannot be undone.',
                ),
              ),
              if (permanent)
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red.shade200),
                  ),
                  child: Text(
                    'Warning: attendance/working-time records may be legally '
                    'required to be kept. Use permanent delete only for test '
                    'or mistaken entries.',
                    style: TextStyle(
                        color: Colors.red.shade900, fontSize: 12.5),
                  ),
                ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(
                  backgroundColor:
                      permanent ? Colors.red.shade900 : Colors.red.shade700),
              onPressed: () => Navigator.of(context).pop(permanent),
              child:
                  Text(permanent ? 'Delete Permanently' : 'Deactivate'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _deleteOne(UserModel user) async {
    final permanent = await _confirmDelete(1);
    if (permanent == null) return;

    try {
      final result = permanent
          ? await _usersService.deleteUserPermanently(user.id)
          : await _usersService.deleteUser(user.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(result['message']?.toString() ??
                (permanent ? 'User permanently deleted' : 'User deactivated'))),
      );
      _loadUsers();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not reach the server.')));
      }
    }
  }

  Future<void> _deleteSelected() async {
    if (_selected.isEmpty) return;
    final permanent = await _confirmDelete(_selected.length);
    if (permanent == null) return;

    setState(() => _loading = true);
    try {
      final result = await _usersService.batchDeleteUsers(
        _selected.toList(),
        permanent: permanent,
      );
      if (!mounted) return;
      final processed = permanent
          ? (result['deletedCount'] ?? 0)
          : (result['deactivatedCount'] ?? 0);
      final failed = result['failedCount'] ?? 0;
      final failures = (result['failedUsers'] as List<dynamic>? ?? [])
          .cast<Map<String, dynamic>>();

      String message = permanent
          ? '$processed user(s) permanently deleted'
          : '$processed user(s) deactivated';
      if (failed > 0) {
        final firstReason = failures.isNotEmpty
            ? failures.first['reason']?.toString() ?? ''
            : '';
        message += ' · $failed failed'
            '${firstReason.isNotEmpty ? ' ($firstReason)' : ''}';
      }
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
      _selected.clear();
      _loadUsers();
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _loading = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) {
        setState(() => _loading = false);
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not reach the server.')));
      }
    }
  }

  // -------------------------------------------------------------------
  // Import (unchanged behavior)
  // -------------------------------------------------------------------

  Future<void> _importUsers() async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['csv', 'xlsx', 'xls'],
      withData: true,
    );
    if (picked == null || picked.files.isEmpty) return;
    final file = picked.files.first;
    if (file.bytes == null) return;

    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await _usersService.importUsers(
        bytes: file.bytes!,
        filename: file.name,
      );
      if (!mounted) return;
      await _showImportResult(result);
      _loadUsers();
    } on ApiException catch (e) {
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  Future<void> _showImportResult(Map<String, dynamic> result) async {
    final created = result['created'] ?? 0;
    final skipped = result['skipped'] ?? 0;
    final rows = (result['results'] as List<dynamic>? ?? [])
        .cast<Map<String, dynamic>>();
    final problems = rows.where((r) => r['status'] == 'skipped').toList();

    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Import finished'),
        content: SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Created: $created · Skipped: $skipped'),
              if (problems.isNotEmpty) ...[
                const SizedBox(height: 12),
                const Text('Skipped rows:',
                    style: TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 240),
                  child: ListView.builder(
                    shrinkWrap: true,
                    itemCount: problems.length,
                    itemBuilder: (context, index) {
                      final p = problems[index];
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        child: Text(
                          'Row ${p['row']}'
                          '${(p['fullName'] ?? '').toString().isNotEmpty ? ' (${p['fullName']})' : ''}'
                          ': ${p['error']}',
                          style: const TextStyle(fontSize: 13),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------

  bool get _allVisibleSelected =>
      _users.isNotEmpty && _users.every((u) => _selected.contains(u.id));

  void _toggleSelectAll() {
    setState(() {
      if (_allVisibleSelected) {
        _selected.clear();
      } else {
        _selected.addAll(_users.map((u) => u.id));
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: _selected.isEmpty
            ? const Text('Users')
            : Text('${_selected.length} selected'),
        actions: [
          if (_selected.isNotEmpty) ...[
            IconButton(
              icon: const Icon(Icons.delete_outline),
              tooltip: 'Deactivate selected',
              onPressed: _loading ? null : _deleteSelected,
            ),
            IconButton(
              icon: const Icon(Icons.close),
              tooltip: 'Clear selection',
              onPressed: () => setState(_selected.clear),
            ),
          ] else ...[
            IconButton(
              icon: const Icon(Icons.upload_file),
              tooltip: 'Import from CSV/Excel',
              onPressed: _loading ? null : _importUsers,
            ),
            IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: _loading ? null : _loadUsers,
            ),
          ],
        ],
      ),
      floatingActionButton: _selected.isEmpty
          ? FloatingActionButton.extended(
              onPressed: _addUser,
              icon: const Icon(Icons.person_add),
              label: const Text('Add user'),
            )
          : FloatingActionButton.extended(
              backgroundColor: Colors.red.shade700,
              foregroundColor: Colors.white,
              onPressed: _loading ? null : _deleteSelected,
              icon: const Icon(Icons.delete_outline),
              label: Text('Deactivate (${_selected.length})'),
            ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(
              children: [
                Expanded(
                  child: SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(value: 'active', label: Text('Active')),
                      ButtonSegment(
                          value: 'inactive', label: Text('Inactive')),
                      ButtonSegment(value: 'all', label: Text('All')),
                    ],
                    selected: {_statusFilter},
                    onSelectionChanged: (selection) {
                      setState(() => _statusFilter = selection.first);
                      _loadUsers();
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Tooltip(
                  message: _allVisibleSelected
                      ? 'Unselect all'
                      : 'Select all visible',
                  child: Checkbox(
                    value: _allVisibleSelected && _users.isNotEmpty,
                    tristate: false,
                    onChanged:
                        _users.isEmpty ? null : (_) => _toggleSelectAll(),
                  ),
                ),
              ],
            ),
          ),
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
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
              FilledButton(onPressed: _loadUsers, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    if (_users.isEmpty) {
      return const Center(child: Text('No users match this filter.'));
    }
    return RefreshIndicator(
      onRefresh: _loadUsers,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 88),
        itemCount: _users.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (context, index) {
          final user = _users[index];
          final selected = _selected.contains(user.id);
          return Card(
            color: selected ? Colors.indigo.shade50 : null,
            child: ListTile(
              leading: Checkbox(
                value: selected,
                onChanged: (v) => setState(() {
                  if (v == true) {
                    _selected.add(user.id);
                  } else {
                    _selected.remove(user.id);
                  }
                }),
              ),
              title: Text(
                user.fullName,
                style: TextStyle(
                  decoration:
                      user.isActive ? null : TextDecoration.lineThrough,
                ),
              ),
              subtitle: Text(
                '${user.email.isNotEmpty ? user.email : (user.phoneNumber ?? 'No contact')}\n'
                '${user.role} · ${user.position?.name ?? 'No position'} · '
                '${user.location?.name ?? 'No location'}'
                '${user.isActive ? '' : ' · INACTIVE'}',
              ),
              isThreeLine: true,
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (!user.isActive)
                    const Padding(
                      padding: EdgeInsets.only(right: 4),
                      child: Icon(Icons.cancel, color: Colors.grey),
                    ),
                  IconButton(
                    icon: Icon(Icons.delete_outline,
                        color: Colors.red.shade700),
                    tooltip: user.isActive
                        ? 'Deactivate / delete'
                        : 'Delete permanently',
                    onPressed: () => _deleteOne(user),
                  ),
                ],
              ),
              onTap: () => _openUser(user),
            ),
          );
        },
      ),
    );
  }
}
