import 'api_client.dart';

/// Result of POST /mobile-token/generate.
class MobileToken {
  final String token;
  final DateTime? expiresAt;
  final int refreshInSeconds;

  const MobileToken({
    required this.token,
    this.expiresAt,
    this.refreshInSeconds = 15,
  });

  factory MobileToken.fromJson(Map<String, dynamic> json) {
    return MobileToken(
      token: json['token'] as String? ?? '',
      expiresAt: json['expiresAt'] != null
          ? DateTime.tryParse(json['expiresAt'] as String)
          : null,
      refreshInSeconds: (json['refreshInSeconds'] as num?)?.toInt() ?? 15,
    );
  }
}

class MobileTokenService {
  final ApiClient _api = ApiClient.instance;

  /// POST /mobile-token/generate — JWT authenticated; token belongs to
  /// the logged-in user and is valid for ~15 seconds, single use.
  Future<MobileToken> generateToken() async {
    final data =
        await _api.post('/mobile-token/generate') as Map<String, dynamic>;
    return MobileToken.fromJson(data);
  }
}
