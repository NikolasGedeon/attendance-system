import 'package:flutter/material.dart';

import 'config/app_mode.dart';
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
