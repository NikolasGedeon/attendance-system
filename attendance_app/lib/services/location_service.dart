import 'package:geolocator/geolocator.dart';

/// Thrown when GPS location cannot be obtained, with a user-friendly message
/// and a stable [code] the UI can branch on (e.g. to offer an Open Settings
/// action when permission is permanently denied).
class LocationException implements Exception {
  final String message;
  final String? code;

  LocationException(this.message, {this.code});

  bool get isPermanentlyDenied =>
      code == 'LOCATION_PERMISSION_PERMANENTLY_DENIED';

  @override
  String toString() => message;
}

/// Device GPS access (not the admin locations API — see LocationsService).
class LocationService {
  /// Checks service + permission, then returns a FRESH high-accuracy position
  /// (not a cached value). Throws [LocationException] with a clear message and
  /// code on any failure.
  Future<Position> getCurrentPosition() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      throw LocationException(
        'Location services are disabled. Please enable GPS/location and try again.',
        code: 'LOCATION_SERVICES_DISABLED',
      );
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        throw LocationException(
          'Location permission was denied. Please allow location access to clock in and out.',
          code: 'LOCATION_PERMISSION_REQUIRED',
        );
      }
    }
    if (permission == LocationPermission.deniedForever) {
      throw LocationException(
        'Location permission is permanently denied. Please enable it in your device settings.',
        code: 'LOCATION_PERMISSION_PERMANENTLY_DENIED',
      );
    }

    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
    } catch (_) {
      throw LocationException(
        'Could not get your location in time. Please make sure GPS is enabled and try again.',
        code: 'LOCATION_TIMEOUT',
      );
    }
  }

  /// Opens the OS app settings so the user can grant location permission.
  Future<void> openLocationSettings() => Geolocator.openAppSettings();
}
