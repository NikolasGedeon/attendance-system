import 'package:flutter/material.dart';

import 'config/app_mode.dart';
import 'main.dart';

void main() {
  runApp(
    const AttendanceApp(
      mode: AppMode.mobile,
    ),
  );
}
