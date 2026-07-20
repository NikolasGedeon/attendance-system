import 'package:flutter/material.dart';

import '../config/app_mode.dart';
import '../models/user_model.dart';
import '../services/app_lock_service.dart';
import '../services/auth_service.dart';
import 'attendance_screen.dart';
import 'kiosk/kiosk_screen.dart';
import 'login_screen.dart';

/// First screen in DEVELOPMENT mode: choose Kiosk Mode (no login)
/// or the employee login flow. In KIOSK/MOBILE builds this screen is
/// skipped entirely (see main.dart).
class StartScreen extends StatelessWidget {
  const StartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(20),
                    child: Image.asset(
                      'assets/branding/app_logo.png',
                      width: (MediaQuery.of(context).size.width * 0.45)
                          .clamp(140.0, 200.0),
                      fit: BoxFit.contain,
                      semanticLabel: 'Marfields Attendance App logo',
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Attendance System',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: 8),
                Text(
                  'Select how you want to continue',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                        color: Colors.grey.shade600,
                      ),
                ),
                if (appMode == AppMode.development) ...[
                  const SizedBox(height: 8),
                  Text(
                    'DEVELOPMENT MODE',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 11,
                      letterSpacing: 2,
                      fontWeight: FontWeight.bold,
                      color: Colors.orange.shade800,
                    ),
                  ),
                ],
                const SizedBox(height: 32),
                if (kioskUiAllowed) ...[
                  _StartCard(
                    icon: Icons.contactless,
                    title: 'Kiosk Mode',
                    subtitle: 'Reception tablet · scan employee cards',
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const KioskScreen()),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                _StartCard(
                  icon: Icons.email_outlined,
                  title: 'Employee Login',
                  subtitle: 'Sign in with your email and password',
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const AuthGate()),
                  ),
                ),
                const SizedBox(height: 16),
                _StartCard(
                  icon: Icons.window_sharp,
                  title: 'Microsoft Login',
                  subtitle:
                      'Coming soon · Microsoft 365 with Authenticator MFA',
                  enabled: false,
                  onTap: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text(
                            'Microsoft login is coming soon. Use Employee Login for now.'),
                      ),
                    );
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _StartCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool enabled;

  const _StartCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.enabled = true,
  });

  @override
  Widget build(BuildContext context) {
    final color = enabled ? null : Colors.grey.shade500;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            children: [
              Icon(icon, size: 40, color: color),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: color,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      style: TextStyle(color: color ?? Colors.grey.shade600),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: color),
            ],
          ),
        ),
      ),
    );
  }
}

/// Entered via "Employee Login" (and directly in MOBILE builds): restores
/// a saved session if one exists, otherwise shows the login screen.
/// Later this widget is where Microsoft login will slot in, without
/// touching the rest of the app.
class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  late final Future<UserModel?> _sessionFuture = _restoreSession();

  Future<UserModel?> _restoreSession() async {
    // Refresh-token based restore: POST /auth/refresh rotates the pair.
    // Returns null (and clears storage) when the token is revoked/expired.
    return AuthService().restoreSession();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<UserModel?>(
      future: _sessionFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        final user = snapshot.data;
        if (user == null) return const LoginScreen();
        // Saved session found: require device unlock
        // (fingerprint / pattern / PIN) before entering the app.
        return AppLockGate(user: user);
      },
    );
  }
}

/// Requires the device screen-lock (biometric or PIN/pattern fallback)
/// before showing the attendance home for a restored session.
/// Skipped automatically on web or devices without any screen lock.
class AppLockGate extends StatefulWidget {
  final UserModel user;

  const AppLockGate({super.key, required this.user});

  @override
  State<AppLockGate> createState() => _AppLockGateState();
}

class _AppLockGateState extends State<AppLockGate> with WidgetsBindingObserver {
  /// Re-lock only when the app was in the background at least this long,
  /// so switching apps briefly (or the biometric dialog itself, which
  /// also pauses the app) does not trigger another prompt.
  static const _relockAfter = Duration(minutes: 2);

  final _lockService = AppLockService();

  bool _checking = true;
  bool _unlocked = false;
  bool _authInProgress = false;
  String? _notice;
  DateTime? _pausedAt;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // First prompt via post-frame callback: never authenticate during build.
    WidgetsBinding.instance.addPostFrameCallback((_) => _tryUnlock());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      _pausedAt ??= DateTime.now();
    } else if (state == AppLifecycleState.resumed) {
      final pausedAt = _pausedAt;
      _pausedAt = null;
      if (pausedAt != null &&
          _unlocked &&
          !_authInProgress &&
          DateTime.now().difference(pausedAt) >= _relockAfter) {
        setState(() => _unlocked = false);
        _tryUnlock();
      }
    }
  }

  Future<void> _tryUnlock() async {
    if (_authInProgress) return;
    setState(() {
      _checking = true;
      _notice = null;
    });

    if (!await _lockService.isSupported()) {
      // Web or no screen lock configured: let the session through.
      if (mounted) {
        setState(() {
          _unlocked = true;
          _checking = false;
        });
      }
      return;
    }

    _authInProgress = true;
    final result = await _lockService.unlock();
    _authInProgress = false;
    if (!mounted) return;

    switch (result) {
      case AppLockResult.success:
        setState(() {
          _unlocked = true;
          _checking = false;
        });
      case AppLockResult.cancelled:
        // Stay on the lock screen; the user chooses to retry or sign out.
        setState(() {
          _unlocked = false;
          _checking = false;
          _notice = 'Unlock was cancelled or failed. '
              'Try again, or sign out and use email login.';
        });
      case AppLockResult.unavailable:
        // Nothing enrolled and no device credential: let the session
        // through, but say so instead of failing silently.
        setState(() {
          _unlocked = true;
          _checking = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'No fingerprint, face or screen lock is set up on this '
              'device — continuing without app lock.',
            ),
          ),
        );
    }
  }

  Future<void> _signOut() async {
    await AuthService().logout();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_unlocked) {
      return AttendanceScreen(user: widget.user);
    }

    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.fingerprint, size: 80, color: Colors.indigo.shade300),
              const SizedBox(height: 16),
              Text(
                'App Locked',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              Text(
                'Unlock with your fingerprint, pattern or PIN to continue '
                'as ${widget.user.fullName}.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey.shade600),
              ),
              if (_notice != null) ...[
                const SizedBox(height: 12),
                Text(
                  _notice!,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 32),
              if (_checking)
                const CircularProgressIndicator()
              else ...[
                FilledButton.icon(
                  onPressed: _tryUnlock,
                  icon: const Icon(Icons.lock_open),
                  label: const Text('Unlock'),
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 32, vertical: 16),
                  ),
                ),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: _signOut,
                  child: const Text('Sign out and use email login'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
