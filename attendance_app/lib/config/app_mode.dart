/// App mode architecture.
///
/// - KIOSK:       company tablet at reception. Boots straight into the
///                kiosk screen; no employee login UI. Kiosk endpoints are
///                unauthenticated (device key based).
/// - MOBILE:      employee phones. Boots into login/auth flow; Kiosk Mode
///                is never shown. All endpoints JWT authenticated.
/// - DEVELOPMENT: shows the start screen with both options (current
///                behavior, for building/testing).
///
/// Configure at build time with:
///   flutter run  --dart-define=APP_MODE=development   (default)
///   flutter build apk --dart-define=APP_MODE=mobile
///   flutter build apk --dart-define=APP_MODE=kiosk
///
/// Or change [_fallbackMode] below for a quick local switch.
enum AppMode { development, kiosk, mobile }

/// Used when no --dart-define=APP_MODE is provided.
const String _fallbackMode = 'development';

const String _rawMode =
    String.fromEnvironment('APP_MODE', defaultValue: _fallbackMode);

AppMode get appMode {
  switch (_rawMode.toLowerCase()) {
    case 'kiosk':
      return AppMode.kiosk;
    case 'mobile':
      return AppMode.mobile;
    default:
      return AppMode.development;
  }
}

/// Kiosk UI is only reachable on kiosk builds and in development.
bool get kioskUiAllowed =>
    appMode == AppMode.kiosk || appMode == AppMode.development;
