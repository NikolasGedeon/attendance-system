import 'package:flutter/material.dart';

import '../../services/api_client.dart';
import '../../services/auth_service.dart';
import '../../widgets/password_field.dart';
import '../start_screen.dart';

/// Web activation page reached from the welcome email:
/// https://attendance.marfields.com/activate-account?token=...
///
/// The raw token lives ONLY in this widget's memory (never persisted) and is
/// dropped once activation succeeds.
class ActivateAccountScreen extends StatefulWidget {
  const ActivateAccountScreen({super.key, required this.token});

  final String token;

  @override
  State<ActivateAccountScreen> createState() => _ActivateAccountScreenState();
}

enum _Phase { validating, form, invalid, submitting, done }

class _ActivateAccountScreenState extends State<ActivateAccountScreen> {
  final _authService = AuthService();
  final _formKey = GlobalKey<FormState>();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();

  _Phase _phase = _Phase.validating;
  String? _error;
  String? _invalidReason;
  String? _emailMasked;

  @override
  void initState() {
    super.initState();
    _checkToken();
  }

  @override
  void dispose() {
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _checkToken() async {
    try {
      final status = await _authService.activationStatus(widget.token);
      if (!mounted) return;
      if (status['valid'] == true) {
        setState(() {
          _emailMasked = status['emailMasked'] as String?;
          _phase = _Phase.form;
        });
      } else {
        setState(() {
          _invalidReason = status['reason'] as String?;
          _phase = _Phase.invalid;
        });
      }
    } catch (_) {
      // If the pre-check can't run, still let the user try to submit.
      if (mounted) setState(() => _phase = _Phase.form);
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _phase = _Phase.submitting;
      _error = null;
    });
    try {
      await _authService.activateAccount(
        token: widget.token,
        password: _passwordController.text,
        confirmPassword: _confirmController.text,
      );
      // Drop the token from memory on success.
      _passwordController.clear();
      _confirmController.clear();
      if (mounted) setState(() => _phase = _Phase.done);
    } on ApiException catch (e) {
      if (!mounted) return;
      // Terminal token states move to the invalid view; others stay on the form.
      const terminal = {
        'ACTIVATION_TOKEN_INVALID',
        'ACTIVATION_TOKEN_EXPIRED',
        'ACTIVATION_TOKEN_USED',
        'ACCOUNT_INACTIVE',
        'ALREADY_ACTIVATED',
      };
      if (e.code != null && terminal.contains(e.code)) {
        setState(() {
          _invalidReason = e.code;
          _phase = _Phase.invalid;
        });
      } else {
        setState(() {
          _error = e.message;
          _phase = _Phase.form;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Could not reach the server. Please try again.';
          _phase = _Phase.form;
        });
      }
    }
  }

  String _reasonText(String? reason) {
    switch (reason) {
      case 'ACTIVATION_TOKEN_EXPIRED':
        return 'This activation link has expired. Ask your administrator to resend it.';
      case 'ACTIVATION_TOKEN_USED':
        return 'This activation link has already been used. Please log in.';
      case 'ACCOUNT_INACTIVE':
        return 'Your account is inactive. Please contact your administrator.';
      case 'ALREADY_ACTIVATED':
        return 'This account is already activated. Please log in.';
      case 'ACTIVATION_TOKEN_INVALID':
      default:
        return 'This activation link is invalid.';
    }
  }

  void _goToLogin() {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const AuthGate()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: _buildBody(),
          ),
        ),
      ),
    );
  }

  Widget _buildBody() {
    switch (_phase) {
      case _Phase.validating:
        return const Padding(
          padding: EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 16),
              Text('Checking your activation link...'),
            ],
          ),
        );
      case _Phase.invalid:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.link_off, size: 56, color: Colors.red.shade400),
            const SizedBox(height: 16),
            Text(
              _reasonText(_invalidReason),
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16),
            ),
            const SizedBox(height: 24),
            OutlinedButton(onPressed: _goToLogin, child: const Text('Go to Login')),
          ],
        );
      case _Phase.done:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.check_circle, size: 56, color: Colors.green.shade600),
            const SizedBox(height: 16),
            const Text(
              'Your account is activated. You can now log in.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 16),
            ),
            const SizedBox(height: 24),
            FilledButton(onPressed: _goToLogin, child: const Text('Go to Login')),
          ],
        );
      case _Phase.form:
      case _Phase.submitting:
        return _buildForm();
    }
  }

  Widget _buildForm() {
    final busy = _phase == _Phase.submitting;
    return Form(
      key: _formKey,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Icon(Icons.lock_open, size: 56),
          const SizedBox(height: 12),
          Text(
            'Create your password',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          if (_emailMasked != null && _emailMasked!.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              _emailMasked!,
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey.shade600),
            ),
          ],
          const SizedBox(height: 24),
          PasswordField(
            controller: _passwordController,
            label: 'New password',
            validator: (v) =>
                (v == null || v.length < 8) ? 'At least 8 characters' : null,
          ),
          const SizedBox(height: 16),
          PasswordField(
            controller: _confirmController,
            label: 'Confirm password',
            textInputAction: TextInputAction.done,
            validator: (v) =>
                v != _passwordController.text ? 'Passwords do not match' : null,
            onFieldSubmitted: (_) => busy ? null : _submit(),
          ),
          const SizedBox(height: 8),
          Text(
            'Use at least 8 characters.',
            style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: TextStyle(color: Colors.red.shade700)),
          ],
          const SizedBox(height: 20),
          FilledButton(
            onPressed: busy ? null : _submit,
            child: busy
                ? const SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Activate account'),
          ),
        ],
      ),
    );
  }
}
