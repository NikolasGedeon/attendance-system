import 'package:geolocator/geolocator.dart';

/// Thrown when GPS location cannot be obtained, with a user-friendly message.
class LocationException implements Exception {
  final String message;

  LocationException(this.message);

  @override
  String toString() => message;
}

/// Device GPS access (not the admin locations API — see LocationsService).
class LocationService {
  /// Checks service + permission, then returns the current position.
  /// Throws [LocationException] with a clear message on any failure.
  Future<Position> getCurrentPosition() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      throw LocationException(
        'Location services are disabled. Please enable GPS/location and try again.',
      );
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        throw LocationException(
          'Location permission was denied. Please allow location access to clock in.',
        );
      }
    }
    if (permission == LocationPermission.deniedForever) {
      throw LocationException(
        'Location permission is permanently denied. Please enable it in your device settings.',
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
        'Could not get your location. Please make sure GPS is enabled and try again.',
      );
    }
  }
}
