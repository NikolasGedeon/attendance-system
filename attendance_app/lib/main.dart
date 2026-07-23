import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'config/app_mode.dart';
import 'screens/auth/activate_account_screen.dart';
import 'screens/auth/reset_password_screen.dart';
import 'screens/kiosk/kiosk_screen.dart';
import 'screens/start_screen.dart';

void main() {
  runApp(const AttendanceApp());
}

class AttendanceApp extends StatelessWidget {
  const AttendanceApp({
    super.key,
    this.mode,
  });

  final AppMode? mode;

  AppMode get _effectiveMode => mode ?? appMode;

  Widget get _home {
    // Web deep link from the password-reset email:
    // https://attendance.marfields.com/reset-password?token=...
    // (Azure Static Web Apps rewrites the path to index.html; the token
    // arrives via Uri.base regardless of the Flutter URL strategy.)
    if (kIsWeb) {
      final uri = Uri.base;
      final token = uri.queryParameters['token'];
      if (token != null && token.isNotEmpty) {
        if (uri.path.endsWith('/reset-password')) {
          return ResetPasswordScreen(token: token);
        }
        // Welcome-email deep link:
        // https://attendance.marfields.com/activate-account?token=...
        if (uri.path.endsWith('/activate-account')) {
          return ActivateAccountScreen(token: token);
        }
      }
    }

    switch (_effectiveMode) {
      case AppMode.kiosk:
        return const KioskScreen();
      case AppMode.mobile:
        return const AuthGate();
      case AppMode.development:
        return const StartScreen();
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Attendance System',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: Colors.indigo,
        useMaterial3: true,
      ),
      home: _home,
    );
  }
}
