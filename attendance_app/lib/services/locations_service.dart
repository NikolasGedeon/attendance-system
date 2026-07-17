import '../models/location_model.dart';
import 'api_client.dart';

class LocationsService {
  final ApiClient _api = ApiClient.instance;

  /// GET /locations
  Future<List<LocationModel>> getLocations() async {
    final data = await _api.get('/locations') as List<dynamic>;
    return data
        .map((l) => LocationModel.fromJson(l as Map<String, dynamic>))
        .toList();
  }

  /// POST /locations
  Future<LocationModel> createLocation({
    required String name,
    required double latitude,
    required double longitude,
    required int radiusMeters,
  }) async {
    final data = await _api.post('/locations', body: {
      'name': name,
      'latitude': latitude,
      'longitude': longitude,
      'radiusMeters': radiusMeters,
    }) as Map<String, dynamic>;
    return LocationModel.fromJson(data);
  }

  /// PATCH /locations/:id
  Future<LocationModel> updateLocation(
    String id, {
    required String name,
    required double latitude,
    required double longitude,
    required int radiusMeters,
    required bool isActive,
  }) async {
    final data = await _api.patch('/locations/$id', body: {
      'name': name,
      'latitude': latitude,
      'longitude': longitude,
      'radiusMeters': radiusMeters,
      'isActive': isActive,
    }) as Map<String, dynamic>;
    return LocationModel.fromJson(data);
  }

  /// DELETE /locations/:id (backend soft-deletes: sets isActive = false)
  Future<void> deactivateLocation(String id) async {
    await _api.delete('/locations/$id');
  }
}
