import 'package:flutter/material.dart';

import '../../models/position_model.dart';
import '../../services/api_client.dart';
import '../../services/positions_service.dart';

/// Manage the list of positions users can be assigned to.
class PositionsAdminScreen extends StatefulWidget {
  const PositionsAdminScreen({super.key});

  @override
  State<PositionsAdminScreen> createState() => _PositionsAdminScreenState();
}

class _PositionsAdminScreenState extends State<PositionsAdminScreen> {
  final _positionsService = PositionsService();

  List<PositionModel> _positions = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final positions = await _positionsService.getPositions();
      if (mounted) setState(() => _positions = positions);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _showNameDialog({PositionModel? position}) async {
    final controller = TextEditingController(text: position?.name ?? '');
    final isEdit = position != null;

    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(isEdit ? 'Rename position' : 'Add position'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Position name',
            border: OutlineInputBorder(),
          ),
          onSubmitted: (v) => Navigator.of(context).pop(v),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text),
            child: Text(isEdit ? 'Save' : 'Add'),
          ),
        ],
      ),
    );
    controller.dispose();

    final trimmed = name?.trim() ?? '';
    if (trimmed.length < 2) return;

    try {
      if (isEdit) {
        await _positionsService.updatePosition(position.id, name: trimmed);
      } else {
        await _positionsService.createPosition(trimmed);
      }
      _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach the server.');
    }
  }

  Future<void> _toggleActive(PositionModel position) async {
    try {
      await _positionsService.updatePosition(
        position.id,
        isActive: !position.isActive,
      );
      _load();
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
        title: const Text('Positions'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loading ? null : _load,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showNameDialog(),
        icon: const Icon(Icons.add),
        label: const Text('Add position'),
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
        children: [
          if (_error != null)
            Card(
              color: Theme.of(context).colorScheme.errorContainer,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  _error!,
                  style: TextStyle(
                      color: Theme.of(context).colorScheme.onErrorContainer),
                ),
              ),
            ),
          if (_positions.isEmpty && _error == null)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(
                child: Text(
                    'No positions yet.\nUse "Add position" to create the list.',
                    textAlign: TextAlign.center),
              ),
            ),
          ..._positions.map(
            (p) => Card(
              child: ListTile(
                leading: Icon(
                  Icons.work_outline,
                  color: p.isActive ? Colors.green : Colors.grey,
                ),
                title: Text(p.isActive ? p.name : '${p.name} (inactive)'),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.edit_outlined),
                      tooltip: 'Rename',
                      onPressed: () => _showNameDialog(position: p),
                    ),
                    Switch(
                      value: p.isActive,
                      onChanged: (_) => _toggleActive(p),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
