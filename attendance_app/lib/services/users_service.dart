import '../models/user_model.dart';
import 'api_client.dart';

class UsersService {
  final ApiClient _api = ApiClient.instance;

  /// GET /users?status=active|inactive|all
  Future<List<UserModel>> getUsers({String status = 'all'}) async {
    final data = await _api.get('/users?status=$status') as List<dynamic>;
    return data
        .map((u) => UserModel.fromJson(u as Map<String, dynamic>))
        .toList();
  }

  /// DELETE /users/:id — soft delete (deactivate). ADMIN only.
  Future<Map<String, dynamic>> deleteUser(String id) async {
    return await _api.delete('/users/$id') as Map<String, dynamic>;
  }

  /// DELETE /users/:id/permanent — removes the user AND all their
  /// attendance history. Irreversible. ADMIN only.
  Future<Map<String, dynamic>> deleteUserPermanently(String id) async {
    return await _api.delete('/users/$id/permanent') as Map<String, dynamic>;
  }

  /// POST /users/batch-delete — deactivate (default) or permanently
  /// delete many users. ADMIN only.
  /// Returns {totalRequested, deactivatedCount, deletedCount,
  /// failedCount, failedUsers}.
  Future<Map<String, dynamic>> batchDeleteUsers(
    List<String> userIds, {
    bool permanent = false,
  }) async {
    return await _api.post('/users/batch-delete', body: {
      'userIds': userIds,
      'permanent': permanent,
    }) as Map<String, dynamic>;
  }

  /// GET /users/:id
  Future<UserModel> getUser(String id) async {
    final data = await _api.get('/users/$id') as Map<String, dynamic>;
    return UserModel.fromJson(data);
  }

  /// POST /users — create a single user manually.
  Future<UserModel> createUser({
    required String fullName,
    String? email,
    String? password,
    required String role,
    String? employeeCode,
    String? department,
    String? phoneNumber,
    String? cardUid,
    bool requireOtpForCard = false,
    String? locationId,
    String? positionId,
    String employeeType = 'INTERNAL',
  }) async {
    final body = <String, dynamic>{
      'fullName': fullName,
      'role': role,
      'requireOtpForCard': requireOtpForCard,
      'employeeType': employeeType,
      if (email != null && email.isNotEmpty) 'email': email,
      if (password != null && password.isNotEmpty) 'password': password,
      if (employeeCode != null && employeeCode.isNotEmpty)
        'employeeCode': employeeCode,
      if (department != null && department.isNotEmpty)
        'department': department,
      if (phoneNumber != null && phoneNumber.isNotEmpty)
        'phoneNumber': phoneNumber,
      if (cardUid != null && cardUid.isNotEmpty) 'cardUid': cardUid,
      if (locationId != null) 'locationId': locationId,
      if (positionId != null) 'positionId': positionId,
    };
    final data = await _api.post('/users', body: body) as Map<String, dynamic>;
    return UserModel.fromJson(data);
  }

  /// POST /users/import — upload a CSV or Excel file.
  /// Returns the raw summary: {total, created, skipped, results: [...]}.
  Future<Map<String, dynamic>> importUsers({
    required List<int> bytes,
    required String filename,
  }) async {
    final data = await _api.uploadFile(
      '/users/import',
      bytes: bytes,
      filename: filename,
    ) as Map<String, dynamic>;
    return data;
  }

  /// PATCH /users/:id
  /// [locationId]/[positionId] are always sent (null = remove assignment).
  /// Empty strings for the optional text fields clear the value.
  Future<UserModel> updateUser(
    String id, {
    required String fullName,
    required String email,
    required String role,
    required bool isActive,
    required String? locationId,
    required String? positionId,
    required String employeeType,
    required String employeeCode,
    required String department,
    required String phoneNumber,
    required String cardUid,
    required bool requireOtpForCard,
  }) async {
    final data = await _api.patch(
      '/users/$id',
      body: {
        'fullName': fullName,
        // null removes the email (card-only user)
        'email': email.trim().isEmpty ? null : email.trim(),
        'role': role,
        'isActive': isActive,
        'locationId': locationId,
        'positionId': positionId,
        'employeeType': employeeType,
        'employeeCode': employeeCode,
        'department': department,
        'phoneNumber': phoneNumber,
        'cardUid': cardUid,
        'requireOtpForCard': requireOtpForCard,
      },
    ) as Map<String, dynamic>;
    return UserModel.fromJson(data);
  }
}
