import '../models/user_model.dart';
import 'api_client.dart';

/// Outcome of POST /auth/login. Routing decisions are based ONLY on the
/// backend flag `requiresPasswordChange` — never on local storage state.
class LoginResult {
  final bool requiresPasswordChange;
  final UserModel user;

  /// Restricted token, present only when requiresPasswordChange is true.
  final String? passwordChangeToken;

  const LoginResult({
    required this.requiresPasswordChange,
    required this.user,
    this.passwordChangeToken,
  });
}

class AuthService {
  final ApiClient _api = ApiClient.instance;

  /// POST /auth/login.
  /// Normal login: saves access+refresh tokens and returns the user.
  /// First login (mustChangePassword): saves NOTHING; returns the
  /// restricted password-change token for the mandatory change screen.
  Future<LoginResult> login(String email, String password) async {
    final data = await _api.post(
      '/auth/login',
      body: {'email': email, 'password': password},
      auth: false,
    ) as Map<String, dynamic>;

    final userJson = data['user'] as Map<String, dynamic>;
    final user = UserModel.fromJson(userJson);

    if (data['requiresPasswordChange'] == true) {
      return LoginResult(
        requiresPasswordChange: true,
        user: user,
        passwordChangeToken: data['passwordChangeToken'] as String,
      );
    }

    await _api.saveSession(
      data['accessToken'] as String,
      data['refreshToken'] as String?,
      userJson,
    );
    return LoginResult(requiresPasswordChange: false, user: user);
  }

  /// First-login mandatory password change. Uses the restricted token,
  /// then saves the normal session returned by the backend.
  Future<UserModel> changeTemporaryPassword({
    required String passwordChangeToken,
    required String currentPassword,
    required String newPassword,
    required String confirmPassword,
  }) async {
    // Temporarily present the restricted token as the bearer token.
    final data = await _api.postWithBearer(
      '/auth/change-temporary-password',
      bearerToken: passwordChangeToken,
      body: {
        'currentPassword': currentPassword,
        'newPassword': newPassword,
        'confirmPassword': confirmPassword,
      },
    ) as Map<String, dynamic>;

    final userJson = data['user'] as Map<String, dynamic>;
    await _api.saveSession(
      data['accessToken'] as String,
      data['refreshToken'] as String?,
      userJson,
    );
    return UserModel.fromJson(userJson);
  }

  /// Authenticated password change (settings). Backend rotates sessions;
  /// the returned fresh pair is saved so the user stays logged in.
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
    required String confirmPassword,
  }) async {
    final data = await _api.post('/auth/change-password', body: {
      'currentPassword': currentPassword,
      'newPassword': newPassword,
      'confirmPassword': confirmPassword,
    }) as Map<String, dynamic>;
    await _api.saveSession(
      data['accessToken'] as String,
      data['refreshToken'] as String?,
      data['user'] as Map<String, dynamic>,
    );
  }

  /// POST /auth/forgot-password — always generic response.
  Future<String> forgotPassword(String email) async {
    final data = await _api.post(
      '/auth/forgot-password',
      body: {'email': email.trim()},
      auth: false,
    ) as Map<String, dynamic>;
    return data['message'] as String? ??
        'If an account exists for this email, a password reset link has been sent.';
  }

  /// POST /auth/reset-password — email-link reset (web route).
  Future<String> resetPassword({
    required String token,
    required String newPassword,
    required String confirmPassword,
  }) async {
    final data = await _api.post(
      '/auth/reset-password',
      body: {
        'token': token,
        'newPassword': newPassword,
        'confirmPassword': confirmPassword,
      },
      auth: false,
    ) as Map<String, dynamic>;
    return data['message'] as String? ?? 'Password has been reset.';
  }

  /// GET /auth/activation-status — safe pre-check of a welcome-email link.
  /// Returns the raw map: {valid, expiresAt?, emailMasked?, reason?}.
  Future<Map<String, dynamic>> activationStatus(String token) async {
    final data = await _api.get(
      '/auth/activation-status?token=${Uri.encodeQueryComponent(token)}',
    ) as Map<String, dynamic>;
    return data;
  }

  /// POST /auth/activate-account — set the first password via the one-time link.
  Future<void> activateAccount({
    required String token,
    required String password,
    required String confirmPassword,
  }) async {
    await _api.post(
      '/auth/activate-account',
      body: {
        'token': token,
        'password': password,
        'confirmPassword': confirmPassword,
      },
      auth: false,
    );
  }

  /// Session restore at app start: refresh-token based. Returns the user
  /// on success; clears storage and returns null when the refresh token
  /// is missing/revoked/expired.
  Future<UserModel?> restoreSession() async {
    final userJson = await _api.refreshSession();
    if (userJson != null) return UserModel.fromJson(userJson);

    // Refresh failed. If it failed due to revocation the client storage
    // was already cleared; if it failed due to network, fall back to the
    // saved user so the app still opens offline (API calls will retry).
    final saved = await _api.getSavedUser();
    final token = await _api.getRefreshToken();
    if (saved != null && token != null) return UserModel.fromJson(saved);
    await _api.clearSession();
    return null;
  }

  /// User saved locally at login (no network call).
  Future<UserModel?> getSavedUser() async {
    final json = await _api.getSavedUser();
    return json != null ? UserModel.fromJson(json) : null;
  }

  Future<bool> isLoggedIn() async => await _api.getToken() != null;

  /// Revokes the refresh token server-side and clears secure storage.
  Future<void> logout() => _api.logout();
}
