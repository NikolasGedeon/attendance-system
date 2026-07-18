import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';

/// Outcome of an unlock attempt, so callers can react differently to
/// "user cancelled" vs "device has nothing to authenticate with".
enum AppLockResult {
  /// Authenticated (biometric or device PIN/pattern/password fallback).
  success,

  /// The user dismissed the prompt or authentication failed; stay locked
  /// and let them retry or sign out.
  cancelled,

  /// No biometric enrolled and no device credential set up — there is
  /// nothing to prompt with. Callers should let the session through with
  /// a visible notice instead of failing silently.
  unavailable,
}

/// Device-level app lock: fingerprint / face / pattern / PIN — whatever
/// screen lock the phone has configured. Not available on web.
class AppLockService {
  final LocalAuthentication _auth = LocalAuthentication();

  /// True when the platform can show a lock prompt (device has a screen
  /// lock or biometrics enrolled). Always false on web.
  Future<bool> isSupported() async {
    if (kIsWeb) return false;
    try {
      final supported = await _auth.isDeviceSupported();
      _log('isDeviceSupported: $supported');
      return supported;
    } catch (e) {
      _log('isDeviceSupported threw: $e');
      return false;
    }
  }

  /// Shows the system unlock prompt. biometricOnly=false means the OS
  /// falls back to pattern/PIN/password when biometrics are unavailable
  /// or fail — exactly the fingerprint-or-pattern-or-PIN behavior.
  Future<AppLockResult> unlock() async {
    try {
      final ok = await _auth.authenticate(
        localizedReason: 'Unlock the Attendance app',
        options: const AuthenticationOptions(
          biometricOnly: false,
          stickyAuth: true,
        ),
      );
      _log('authenticate returned $ok');
      return ok ? AppLockResult.success : AppLockResult.cancelled;
    } on PlatformException catch (e) {
      _log('authenticate PlatformException: ${e.code} — ${e.message}');
      switch (e.code) {
        // Nothing on the device can authenticate the user.
        case 'NotAvailable':
        case 'NotEnrolled':
        case 'PasscodeNotSet':
          return AppLockResult.unavailable;
        // LockedOut / PermanentlyLockedOut / anything else: stay locked,
        // the user can retry (possibly after the OS cooldown) or sign out.
        default:
          return AppLockResult.cancelled;
      }
    } catch (e) {
      _log('authenticate threw: $e');
      return AppLockResult.cancelled;
    }
  }

  void _log(String message) {
    if (kDebugMode) debugPrint('[AppLock] $message');
  }
}
