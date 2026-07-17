import 'package:flutter/foundation.dart';

/// Central place to configure the backend base URL.
///
/// - Android emulator: http://10.0.2.2:3000 (10.0.2.2 = host machine's localhost)
/// - Flutter Web / Windows desktop on the same PC: http://localhost:3000
/// - Physical device: replace with your PC's LAN IP, e.g. http://192.168.1.50:3000
class ApiConfig {
  ApiConfig._();

  /// Production/staging override, set at build time:
  ///   flutter build apk --dart-define=API_BASE_URL=https://your-app.azurewebsites.net
  /// Takes priority over everything below when provided.
  static const String _envBaseUrl =
      String.fromEnvironment('API_BASE_URL', defaultValue: '');

  /// Override this manually if needed (e.g. physical device / staging server).
  /// Leave null to auto-detect based on platform.
  ///
  /// IMPORTANT: on a physical phone, "localhost" means the phone itself!
  /// Use your PC's LAN IP (run `ipconfig` -> IPv4 Address) for real devices.
  /// For Flutter Web / desktop on the same PC, localhost is correct.
  static const String? manualBaseUrl = 'http://192.168.100.97:3000';

  static String get baseUrl {
    if (_envBaseUrl.isNotEmpty) return _envBaseUrl;
    if (manualBaseUrl != null) return manualBaseUrl!;
    if (kIsWeb) return 'http://localhost:3000';
    if (defaultTargetPlatform == TargetPlatform.android) {
      return 'http://10.0.2.2:3000';
    }
    return 'http://localhost:3000';
  }
}