import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../services/api_client.dart';
import '../../services/mobile_token_service.dart';

/// Shows a rotating single-use attendance token for the logged-in user.
/// The kiosk validates it via POST /kiosk/mobile-token-scan.
/// A QR rendering of the same token will be added later.
class MobileTokenScreen extends StatefulWidget {
  const MobileTokenScreen({super.key});

  @override
  State<MobileTokenScreen> createState() => _MobileTokenScreenState();
}

class _MobileTokenScreenState extends State<MobileTokenScreen> {
  final _tokenService = MobileTokenService();

  MobileToken? _token;
  int _secondsLeft = 0;
  bool _loading = true;
  String? _error;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _refreshToken();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refreshToken() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final token = await _tokenService.generateToken();
      if (!mounted) return;
      setState(() {
        _token = token;
        _secondsLeft = token.refreshInSeconds;
      });
      _startCountdown();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _startCountdown() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return;
      setState(() => _secondsLeft--);
      if (_secondsLeft <= 0) {
        timer.cancel();
        _refreshToken(); // auto-rotate
      }
    });
  }

  Future<void> _copyToken() async {
    final token = _token?.token;
    if (token == null || token.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: token));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Token copied to clipboard')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final token = _token;
    final progress = token == null || token.refreshInSeconds == 0
        ? 0.0
        : _secondsLeft / token.refreshInSeconds;

    return Scaffold(
      appBar: AppBar(title: const Text('Send Token to Scanner')),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              children: [
                // Live QR of the rotating token — scan it at the kiosk
                // with a 2D scanner gun (or camera, later).
                Container(
                  width: 240,
                  height: 240,
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: Colors.indigo.shade200, width: 2),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: _loading
                      ? const Center(child: CircularProgressIndicator())
                      : (token != null && token.token.isNotEmpty)
                          ? QrImageView(
                              data: token.token,
                              version: QrVersions.auto,
                              gapless: true,
                              backgroundColor: Colors.white,
                            )
                          : Icon(Icons.qr_code_2,
                              size: 170, color: Colors.indigo.shade300),
                ),
                const SizedBox(height: 20),
                if (_error != null) ...[
                  Card(
                    color: Theme.of(context).colorScheme.errorContainer,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                            color:
                                Theme.of(context).colorScheme.onErrorContainer),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: _loading ? null : _refreshToken,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Try Again'),
                  ),
                ] else if (token != null) ...[
                  Text(
                    'Your attendance token',
                    style: TextStyle(color: Colors.grey.shade600),
                  ),
                  const SizedBox(height: 8),
                  SelectableText(
                    token.token,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 1.2,
                    ),
                  ),
                  const SizedBox(height: 16),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: LinearProgressIndicator(
                      value: progress.clamp(0.0, 1.0),
                      minHeight: 8,
                      color: _secondsLeft <= 5
                          ? Colors.orange.shade700
                          : Colors.indigo,
                      backgroundColor: Colors.grey.shade200,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Refreshes in $_secondsLeft s · single use',
                    style: TextStyle(
                      fontSize: 12,
                      color: _secondsLeft <= 5
                          ? Colors.orange.shade800
                          : Colors.grey.shade600,
                    ),
                  ),
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _copyToken,
                          icon: const Icon(Icons.copy, size: 18),
                          label: const Text('Copy Token'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _loading ? null : _refreshToken,
                          icon: const Icon(Icons.refresh, size: 18),
                          label: const Text('New Token'),
                        ),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 16),
                TextButton.icon(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.arrow_back),
                  label: const Text('Back'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
