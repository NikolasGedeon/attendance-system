import 'package:flutter/material.dart';

import '../../models/user_model.dart';
import '../../services/api_client.dart';
import '../../services/auth_service.dart';
import '../../widgets/password_field.dart';
import '../start_screen.dart';

/// Mandatory first-login password change. Shown ONLY when the backend
/// returned requiresPasswordChange=true (server-controlled; never inferred
/// from local storage). The user cannot reach the rest of the app until
/// the password is changed — there is no skip action.
class ChangeTemporaryPasswordScreen extends StatefulWidget {
  final UserModel user;
  final String passwordChangeToken;

  const ChangeTemporaryPasswordScreen({
    super.key,
    required this.user,
    required this.passwordChangeToken,
  });

  @override
  State<ChangeTemporaryPasswordScreen> createState() =>
      _ChangeTemporaryPasswordScreenState();
}

class _ChangeTemporaryPasswordScreenState
    extends State<ChangeTemporaryPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _currentController = TextEditingController();
  final _newController = TextEditingController();
  final _confirmController = TextEditingController();

  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _currentController.dispose();
    _newController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final user = await AuthService().changeTemporaryPassword(
        passwordChangeToken: widget.passwordChangeToken,
        currentPassword: _currentController.text,
        newPassword: _newController.text,
        confirmPassword: _confirmController.text,
      );
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => AppLockGate(user: user)),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not reach the server. Is it running?');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Set Your Password'),
        automaticallyImplyLeading: false, // no back: change is mandatory
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.password, size: 56),
                  const SizedBox(height: 12),
                  Text(
                    'Welcome, ${widget.user.fullName}',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Your password was set by an administrator. '
                    'Choose your own password to continue.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.grey.shade600),
                  ),
                  const SizedBox(height: 24),
                  PasswordField(
                    controller: _currentController,
                    label: 'Temporary password',
                    validator: (v) => (v == null || v.isEmpty)
                        ? 'Enter the temporary password'
                        : null,
                  ),
                  const SizedBox(height: 16),
                  PasswordField(
                    controller: _newController,
                    label: 'New password',
                    validator: (v) => (v == null || v.length < 8)
                        ? 'At least 8 characters'
                        : null,
                  ),
                  const SizedBox(height: 16),
                  PasswordField(
                    controller: _confirmController,
                    label: 'Confirm new password',
                    textInputAction: TextInputAction.done,
                    validator: (v) => v != _newController.text
                        ? 'Passwords do not match'
                        : null,
                    onFieldSubmitted: (_) => _loading ? null : _submit(),
                  ),
                  const SizedBox(height: 24),
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
                    onPressed: _loading ? null : _submit,
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                    ),
                    child: _loading
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Change Password'),
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
