import 'package:flutter/material.dart';

import 'config/app_mode.dart';
import 'screens/kiosk/kiosk_screen.dart';
import 'screens/start_screen.dart';

void main() {
  runApp(const AttendanceApp());
}

class AttendanceApp extends StatelessWidget {
  const AttendanceApp({super.key});

  Widget get _home {
    switch (appMode) {
      case AppMode.kiosk:
        // Company tablet: straight to the kiosk, no login UI.
        return const KioskScreen();
      case AppMode.mobile:
        // Employee phone: straight to auth flow, no kiosk option.
        return const AuthGate();
      case AppMode.development:
        // Developer build: choose between both flows.
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
