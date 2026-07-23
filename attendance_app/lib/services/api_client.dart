import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import '../config/api_config.dart';
import 'download/file_saver_io.dart'
    if (dart.library.html) 'download/file_saver_web.dart';

/// Thrown when the API returns a non-2xx response.
class ApiException implements Exception {
  final int statusCode;
  final String message;

  /// Full decoded error body (may carry extra flags, e.g. kiosk OTP `locked`).
  final Map<String, dynamic>? data;

  ApiException(this.statusCode, this.message, {this.data});

  /// True when the backend flagged the card as OTP-locked.
  bool get locked => data?['locked'] == true;

  int? get attemptsRemaining => (data?['attemptsRemaining'] as num?)?.toInt();

  /// Stable machine-readable error code from the backend body, if present
  /// (e.g. ACCOUNT_ACTIVATION_REQUIRED, ACTIVATION_TOKEN_EXPIRED).
  String? get code => data?['code'] as String?;

  @override
  String toString() => message;
}

/// Shared HTTP helper: builds URLs, attaches the Bearer token, decodes
/// JSON, turns error responses into ApiException, and transparently
/// refreshes the access token once on 401 (refresh token rotation).
///
/// Storage policy: ONLY tokens and minimal user metadata live in
/// flutter_secure_storage. The password is never stored anywhere.
class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  static const _storage = FlutterSecureStorage();
  static const _tokenKey = 'accessToken';
  static const _refreshTokenKey = 'refreshToken';
  static const _userKey = 'user';

  /// Single-flight guard so concurrent 401s trigger one refresh call.
  Future<bool>? _refreshing;

  Future<String?> getToken() => _storage.read(key: _tokenKey);

  Future<String?> getRefreshToken() => _storage.read(key: _refreshTokenKey);

  Future<void> saveSession(
    String accessToken,
    String? refreshToken,
    Map<String, dynamic> user,
  ) async {
    await _storage.write(key: _tokenKey, value: accessToken);
    if (refreshToken != null) {
      await _storage.write(key: _refreshTokenKey, value: refreshToken);
    }
    await _storage.write(key: _userKey, value: jsonEncode(user));
  }

  Future<Map<String, dynamic>?> getSavedUser() async {
    final raw = await _storage.read(key: _userKey);
    if (raw == null) return null;
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  Future<void> clearSession() async {
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _refreshTokenKey);
    await _storage.delete(key: _userKey);
  }

  /// POST /auth/refresh with the stored refresh token. On success the new
  /// rotated pair is saved and the user payload returned; on any failure
  /// the session is cleared and null returned.
  Future<Map<String, dynamic>?> refreshSession() async {
    final refreshToken = await getRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) return null;

    try {
      final res = await http.post(
        _uri('/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'refreshToken': refreshToken}),
      );
      if (res.statusCode < 200 || res.statusCode >= 300) {
        await clearSession();
        return null;
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final user = data['user'] as Map<String, dynamic>;
      await saveSession(
        data['accessToken'] as String,
        data['refreshToken'] as String?,
        user,
      );
      return user;
    } catch (_) {
      // Network failure: keep the stored tokens; caller decides.
      return null;
    }
  }

  /// Revokes the refresh token server-side and clears local storage.
  Future<void> logout() async {
    final refreshToken = await getRefreshToken();
    if (refreshToken != null && refreshToken.isNotEmpty) {
      try {
        await http.post(
          _uri('/auth/logout'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'refreshToken': refreshToken}),
        );
      } catch (_) {
        // Best effort; local clear still happens.
      }
    }
    await clearSession();
  }

  Future<Map<String, String>> _headers({bool auth = true}) async {
    final headers = {'Content-Type': 'application/json'};
    if (auth) {
      final token = await getToken();
      if (token != null) headers['Authorization'] = 'Bearer $token';
    }
    return headers;
  }

  Uri _uri(String path) => Uri.parse('${ApiConfig.baseUrl}$path');

  /// Runs the request; on 401 (authenticated calls only) refreshes the
  /// session once and retries once.
  Future<http.Response> _withRefreshRetry(
    Future<http.Response> Function() send, {
    required bool auth,
  }) async {
    final res = await send();
    if (auth && res.statusCode == 401) {
      _refreshing ??= refreshSession().then((user) {
        _refreshing = null;
        return user != null;
      });
      final refreshed = await _refreshing!;
      if (refreshed) return send();
    }
    return res;
  }

  Future<dynamic> get(String path) async {
    final res = await _withRefreshRetry(
      () async => http.get(_uri(path), headers: await _headers()),
      auth: true,
    );
    return _handle(res);
  }

  Future<dynamic> post(String path,
      {Map<String, dynamic>? body, bool auth = true}) async {
    final res = await _withRefreshRetry(
      () async => http.post(
        _uri(path),
        headers: await _headers(auth: auth),
        body: body != null ? jsonEncode(body) : null,
      ),
      auth: auth,
    );
    return _handle(res);
  }

  /// POST with an explicit bearer token (e.g. the restricted
  /// password-change token) instead of the stored access token.
  /// No refresh retry: restricted tokens cannot be refreshed.
  Future<dynamic> postWithBearer(
    String path, {
    required String bearerToken,
    Map<String, dynamic>? body,
  }) async {
    final res = await http.post(
      _uri(path),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $bearerToken',
      },
      body: body != null ? jsonEncode(body) : null,
    );
    return _handle(res);
  }

  Future<dynamic> patch(String path, {Map<String, dynamic>? body}) async {
    final res = await _withRefreshRetry(
      () async => http.patch(
        _uri(path),
        headers: await _headers(),
        body: body != null ? jsonEncode(body) : null,
      ),
      auth: true,
    );
    return _handle(res);
  }

  Future<dynamic> delete(String path) async {
    final res = await _withRefreshRetry(
      () async => http.delete(_uri(path), headers: await _headers()),
      auth: true,
    );
    return _handle(res);
  }

  /// Authenticated file download. Fetches the bytes with the Bearer token
  /// and saves them: on web this triggers a browser download; on
  /// mobile/desktop it writes to a temp file and returns the path.
  Future<String?> downloadFile({
    required String path,
    Map<String, String>? queryParams,
    required String filename,
  }) async {
    var uri = _uri(path);
    final params = <String, String>{
      ...uri.queryParameters,
      ...?queryParams,
    }..removeWhere((_, v) => v.isEmpty);
    if (params.isNotEmpty) {
      uri = uri.replace(queryParameters: params);
    }

    final res = await _withRefreshRetry(
      () async => http.get(uri, headers: await _headers()),
      auth: true,
    );
    if (res.statusCode < 200 || res.statusCode >= 300) {
      _handle(res); // throws ApiException with the backend message
    }

    final mimeType = res.headers['content-type'] ?? 'application/octet-stream';
    return saveFileBytes(filename, res.bodyBytes, mimeType);
  }

  /// Multipart file upload (e.g. CSV/Excel import). Sends the Bearer token.
  Future<dynamic> uploadFile(
    String path, {
    required List<int> bytes,
    required String filename,
    String field = 'file',
  }) async {
    Future<http.Response> send() async {
      final request = http.MultipartRequest('POST', _uri(path));
      final token = await getToken();
      if (token != null) request.headers['Authorization'] = 'Bearer $token';
      request.files.add(
        http.MultipartFile.fromBytes(field, bytes, filename: filename),
      );
      final streamed = await request.send();
      return http.Response.fromStream(streamed);
    }

    final res = await _withRefreshRetry(send, auth: true);
    return _handle(res);
  }

  dynamic _handle(http.Response res) {
    final dynamic decoded = res.body.isNotEmpty ? jsonDecode(res.body) : null;
    if (res.statusCode >= 200 && res.statusCode < 300) return decoded;

    String message = 'Request failed (${res.statusCode})';
    if (decoded is Map<String, dynamic>) {
      final m = decoded['message'];
      if (m is String) message = m;
      if (m is List) message = m.join(', ');
    }
    throw ApiException(
      res.statusCode,
      message,
      data: decoded is Map<String, dynamic> ? decoded : null,
    );
  }
}
