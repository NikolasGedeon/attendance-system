import 'package:flutter/foundation.dart';
import 'package:local_auth/local_auth.dart';

/// Device-level app lock: fingerprint / face / pattern / PIN — whatever
/// screen lock the phone has configured. Not available on web.
class AppLockService {
  final LocalAuthentication _auth = LocalAuthentication();

  /// True when the platform can show a lock prompt (device has a screen
  /// lock or biometrics enrolled). Always false on web.
  Future<bool> isSupported() async {
    if (kIsWeb) return false;
    try {
      return await _auth.isDeviceSupported();
    } catch (_) {
      return false;
    }
  }

  /// Shows the system unlock prompt. biometricOnly=false means the OS
  /// falls back to pattern/PIN/password when biometrics are unavailable
  /// or fail — exactly the fingerprint-or-pattern-or-PIN behavior.
  Future<bool> unlock() async {
    try {
      return await _auth.authenticate(
        localizedReason: 'Unlock the Attendance app',
        options: const AuthenticationOptions(
          biometricOnly: false,
          stickyAuth: true,
        ),
      );
    } catch (_) {
      return false;
    }
  }
}
