import '../models/user_model.dart';
import 'api_client.dart';

class AuthService {
  final ApiClient _api = ApiClient.instance;

  /// POST /auth/login — saves token + user on success, returns the user.
  Future<UserModel> login(String email, String password) async {
    final data = await _api.post(
      '/auth/login',
      body: {'email': email, 'password': password},
      auth: false,
    ) as Map<String, dynamic>;

    final token = data['accessToken'] as String;
    final userJson = data['user'] as Map<String, dynamic>;
    await _api.saveSession(token, userJson);
    return UserModel.fromJson(userJson);
  }

  /// GET /auth/me — current user from the backend.
  Future<UserModel> me() async {
    final data = await _api.get('/auth/me') as Map<String, dynamic>;
    return UserModel.fromJson(data);
  }

  /// User saved locally at login (no network call).
  Future<UserModel?> getSavedUser() async {
    final json = await _api.getSavedUser();
    return json != null ? UserModel.fromJson(json) : null;
  }

  Future<bool> isLoggedIn() async => await _api.getToken() != null;

  Future<void> logout() => _api.clearSession();
}
