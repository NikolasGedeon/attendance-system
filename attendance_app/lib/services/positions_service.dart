import '../models/position_model.dart';
import 'api_client.dart';

class PositionsService {
  final ApiClient _api = ApiClient.instance;

  /// GET /positions
  Future<List<PositionModel>> getPositions() async {
    final data = await _api.get('/positions') as List<dynamic>;
    return data
        .map((p) => PositionModel.fromJson(p as Map<String, dynamic>))
        .toList();
  }

  /// POST /positions
  Future<PositionModel> createPosition(String name) async {
    final data = await _api.post('/positions', body: {'name': name})
        as Map<String, dynamic>;
    return PositionModel.fromJson(data);
  }

  /// PATCH /positions/:id
  Future<PositionModel> updatePosition(
    String id, {
    String? name,
    bool? isActive,
  }) async {
    final data = await _api.patch('/positions/$id', body: {
      if (name != null) 'name': name,
      if (isActive != null) 'isActive': isActive,
    }) as Map<String, dynamic>;
    return PositionModel.fromJson(data);
  }

  /// DELETE /positions/:id (soft delete — deactivates)
  Future<void> deactivatePosition(String id) async {
    await _api.delete('/positions/$id');
  }
}
