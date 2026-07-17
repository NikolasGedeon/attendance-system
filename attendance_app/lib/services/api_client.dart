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

  @override
  String toString() => message;
}

/// Shared HTTP helper: builds URLs, attaches the Bearer token,
/// decodes JSON, and turns error responses into ApiException.
class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  static const _storage = FlutterSecureStorage();
  static const _tokenKey = 'accessToken';
  static const _userKey = 'user';

  Future<String?> getToken() => _storage.read(key: _tokenKey);

  Future<void> saveSession(String token, Map<String, dynamic> user) async {
    await _storage.write(key: _tokenKey, value: token);
    await _storage.write(key: _userKey, value: jsonEncode(user));
  }

  Future<Map<String, dynamic>?> getSavedUser() async {
    final raw = await _storage.read(key: _userKey);
    if (raw == null) return null;
    return jsonDecode(raw) as Map<String, dynamic>;
  }

  Future<void> clearSession() async {
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _userKey);
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

  Future<dynamic> get(String path) async {
    final res = await http.get(_uri(path), headers: await _headers());
    return _handle(res);
  }

  Future<dynamic> post(String path,
      {Map<String, dynamic>? body, bool auth = true}) async {
    final res = await http.post(
      _uri(path),
      headers: await _headers(auth: auth),
      body: body != null ? jsonEncode(body) : null,
    );
    return _handle(res);
  }

  Future<dynamic> patch(String path, {Map<String, dynamic>? body}) async {
    final res = await http.patch(
      _uri(path),
      headers: await _headers(),
      body: body != null ? jsonEncode(body) : null,
    );
    return _handle(res);
  }

  Future<dynamic> delete(String path) async {
    final res = await http.delete(_uri(path), headers: await _headers());
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

    final res = await http.get(uri, headers: await _headers());
    if (res.statusCode < 200 || res.statusCode >= 300) {
      _handle(res); // throws ApiException with the backend message
    }

    final mimeType =
        res.headers['content-type'] ?? 'application/octet-stream';
    return saveFileBytes(filename, res.bodyBytes, mimeType);
  }

  /// Multipart file upload (e.g. CSV/Excel import). Sends the Bearer token.
  Future<dynamic> uploadFile(
    String path, {
    required List<int> bytes,
    required String filename,
    String field = 'file',
  }) async {
    final request = http.MultipartRequest('POST', _uri(path));
    final token = await getToken();
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    request.files.add(
      http.MultipartFile.fromBytes(field, bytes, filename: filename),
    );
    final streamed = await request.send();
    final res = await http.Response.fromStream(streamed);
    return _handle(res);
  }

  dynamic _handle(http.Response res) {
    final dynamic decoded =
        res.body.isNotEmpty ? jsonDecode(res.body) : null;
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
