import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../services/api_client.dart';
import '../../services/kiosk_qr_service.dart';

/// Employee phone camera scanner for the QR displayed on the kiosk.
/// Scans only attendance kiosk payloads (AQR1: prefix), guards against
/// duplicate detections, and stops the camera after a valid scan.
class ScanKioskQrScreen extends StatefulWidget {
  const ScanKioskQrScreen({super.key});

  @override
  State<ScanKioskQrScreen> createState() => _ScanKioskQrScreenState();
}

enum _ScanState { scanning, processing, success, error }

class _ScanKioskQrScreenState extends State<ScanKioskQrScreen> {
  final _qrService = KioskQrService();
  final _controller = MobileScannerController();

  _ScanState _state = _ScanState.scanning;
  KioskQrScanResult? _result;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    // Ignore detections unless we are actively scanning (duplicate guard).
    if (_state != _ScanState.scanning) return;

    final payload = capture.barcodes
        .map((b) => b.rawValue)
        .firstWhere(KioskQrService.isKioskQrPayload, orElse: () => null);
    if (payload == null) return; // not an attendance kiosk QR — keep scanning

    setState(() => _state = _ScanState.processing);
    await _controller.stop();

    try {
      final result = await _qrService.scan(payload);
      if (!mounted) return;
      setState(() {
        _result = result;
        _state = _ScanState.success;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _state = _ScanState.error;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not reach the server. Check your connection.';
        _state = _ScanState.error;
      });
    }
  }

  Future<void> _scanAgain() async {
    setState(() {
      _state = _ScanState.scanning;
      _error = null;
      _result = null;
    });
    await _controller.start();
  }

  String _formatTime(DateTime dt) {
    final local = dt.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)}/${local.year} '
        '${two(local.hour)}:${two(local.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan Kiosk QR')),
      body: kIsWeb ? _buildWebUnsupported() : _buildBody(),
    );
  }

  Widget _buildWebUnsupported() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.qr_code_scanner, size: 72, color: Colors.grey.shade400),
            const SizedBox(height: 16),
            const Text(
              'Camera scanning is not supported in the browser. '
              'Use the Android or iPhone app to scan the kiosk QR.',
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    switch (_state) {
      case _ScanState.scanning:
      case _ScanState.processing:
        return Stack(
          children: [
            MobileScanner(
              controller: _controller,
              onDetect: _onDetect,
            ),
            // Simple viewfinder hint
            Align(
              alignment: Alignment.topCenter,
              child: Container(
                margin: const EdgeInsets.all(16),
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.black54,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Text(
                  'Point the camera at the QR code on the kiosk screen',
                  style: TextStyle(color: Colors.white),
                ),
              ),
            ),
            if (_state == _ScanState.processing)
              Container(
                color: Colors.black45,
                child: const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      CircularProgressIndicator(color: Colors.white),
                      SizedBox(height: 16),
                      Text(
                        'Confirming with the server...',
                        style: TextStyle(color: Colors.white),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        );
      case _ScanState.success:
        final result = _result!;
        final isIn = result.action == 'CLOCK_IN';
        return _centeredCard([
          Icon(
            isIn ? Icons.login : Icons.logout,
            size: 80,
            color: Colors.green.shade600,
          ),
          const SizedBox(height: 16),
          Text(
            isIn ? 'Clocked in' : 'Clocked out',
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(color: Colors.green.shade700),
          ),
          const SizedBox(height: 8),
          if (result.employeeName != null)
            Text(result.employeeName!,
                style: Theme.of(context).textTheme.titleMedium),
          if (result.time != null) ...[
            const SizedBox(height: 4),
            Text(_formatTime(result.time!)),
          ],
          if (result.kioskName != null) ...[
            const SizedBox(height: 4),
            Text(
              result.kioskLocation != null
                  ? '${result.kioskName} · ${result.kioskLocation}'
                  : result.kioskName!,
              style: TextStyle(color: Colors.grey.shade600),
            ),
          ],
          const SizedBox(height: 32),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 48, vertical: 16),
            ),
            child: const Text('Done'),
          ),
        ]);
      case _ScanState.error:
        return _centeredCard([
          Icon(Icons.error_outline, size: 72, color: Colors.red.shade400),
          const SizedBox(height: 16),
          Text(
            _error ?? 'Something went wrong.',
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 32),
          FilledButton.icon(
            onPressed: _scanAgain,
            icon: const Icon(Icons.qr_code_scanner),
            label: const Text('Scan again'),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
        ]);
    }
  }

  Widget _centeredCard(List<Widget> children) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 400),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: children,
          ),
        ),
      ),
    );
  }
}
