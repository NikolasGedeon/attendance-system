import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../config/feature_flags.dart';
import '../../services/api_client.dart';
import '../../services/kiosk_qr_service.dart';
import '../../services/kiosk_service.dart';

enum _KioskStage {
  waiting,
  otp,
  success,
  adminVerify,
  adminActions,
  mobileToken,
  kioskQr,
}

const _defaultReason = 'Employee failed OTP verification';

class KioskScreen extends StatefulWidget {
  const KioskScreen({super.key});

  @override
  State<KioskScreen> createState() => _KioskScreenState();
}

class _KioskScreenState extends State<KioskScreen> {
  final _kioskService = KioskService();

  _KioskStage _stage = _KioskStage.waiting;
  bool _busy = false;
  String? _error;
  bool _showAdminHelp = false;

  // Waiting stage
  final _cardController = TextEditingController();

  // Mobile token stage (legacy employee-displayed QR flow)
  final _mobileTokenController = TextEditingController();

  // Kiosk-displayed QR stage (new flow)
  final _kioskQrService = KioskQrService();
  KioskQrChallenge? _qrChallenge;
  KioskQrStatus? _qrConsumed;
  int _qrSecondsLeft = 0;
  bool _qrLoading = false;
  String? _qrError;
  Timer? _qrCountdownTimer;
  Timer? _qrPollTimer;
  Timer? _qrSuccessTimer;

  // OTP stage
  final _otpController = TextEditingController();
  final _otpFocusNode = FocusNode();
  String? _otpRequestId;
  String _otpAction = '';
  String? _devOtpCode;
  int _secondsLeft = 0;
  Timer? _countdownTimer;

  // Success stage
  String _successAction = '';
  String? _successName;
  Timer? _successTimer;

  // Admin stages
  final _adminCardController = TextEditingController();
  final _employeeIdController = TextEditingController();
  final _reasonController = TextEditingController(text: _defaultReason);
  String? _verifiedAdminCardUid;
  String? _verifiedAdminName;

  /// Loaded via POST /kiosk/admin/users after admin card verification.
  /// Null = load failed, fall back to manual ID input.
  List<KioskEmployee>? _kioskUsers;
  String? _selectedEmployeeName;

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _successTimer?.cancel();
    _stopQrTimers();
    _cardController.dispose();
    _mobileTokenController.dispose();
    _otpController.dispose();
    _otpFocusNode.dispose();
    _adminCardController.dispose();
    _employeeIdController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  void _reset() {
    _countdownTimer?.cancel();
    _successTimer?.cancel();
    _stopQrTimers();
    // Close the OTP keypad when returning to the scan screen.
    _otpFocusNode.unfocus();
    setState(() {
      _qrChallenge = null;
      _qrConsumed = null;
      _qrSecondsLeft = 0;
      _qrLoading = false;
      _qrError = null;
      _stage = _KioskStage.waiting;
      _busy = false;
      _error = null;
      _showAdminHelp = false;
      _cardController.clear();
      _mobileTokenController.clear();
      _otpController.clear();
      _otpRequestId = null;
      _otpAction = '';
      _devOtpCode = null;
      _secondsLeft = 0;
      _successAction = '';
      _successName = null;
      _adminCardController.clear();
      _employeeIdController.clear();
      _reasonController.text = _defaultReason;
      _verifiedAdminCardUid = null;
      _verifiedAdminName = null;
      _kioskUsers = null;
      _selectedEmployeeName = null;
    });
  }

  void _startCountdown(int seconds) {
    _countdownTimer?.cancel();
    setState(() => _secondsLeft = seconds);
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return;
      setState(() {
        _secondsLeft--;
        if (_secondsLeft <= 0) {
          timer.cancel();
        }
      });
    });
  }

  void _showSuccess(String action, String? name) {
    _countdownTimer?.cancel();
    setState(() {
      _stage = _KioskStage.success;
      _successAction = action;
      _successName = name;
      _error = null;
    });
    _successTimer?.cancel();
    _successTimer = Timer(const Duration(seconds: 3), () {
      if (mounted) _reset();
    });
  }

  Future<void> _scanCard() async {
    final cardUid = _cardController.text.trim();
    if (cardUid.isEmpty) {
      setState(() => _error = 'Enter or scan a card UID');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
      _showAdminHelp = false;
    });
    try {
      final result = await _kioskService.cardScan(cardUid);
      if (!mounted) return;
      if (result.requiresOtp) {
        setState(() {
          _stage = _KioskStage.otp;
          _otpRequestId = result.otpRequestId;
          _otpAction = result.action;
          _devOtpCode = result.devOtpCode;
          _otpController.clear();
        });
        _startCountdown(result.expiresInSeconds ?? 30);
        // Focus the OTP field once the stage is rendered so the numeric
        // keypad opens without the user tapping the field.
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && _stage == _KioskStage.otp) {
            _otpFocusNode.requestFocus();
          }
        });
      } else {
        _showSuccess(result.action, result.userFullName);
      }
    } on ApiException catch (e) {
      setState(() {
        _error = e.message;
        _showAdminHelp = e.locked;
      });
    } catch (_) {
      setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verifyOtp() async {
    final code = _otpController.text.trim();
    if (code.isEmpty) {
      setState(() => _error = 'Enter the OTP code');
      return;
    }
    final otpRequestId = _otpRequestId;
    if (otpRequestId == null) {
      _reset();
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await _kioskService.verifyOtp(
        otpRequestId: otpRequestId,
        code: code,
      );
      if (!mounted) return;
      _showSuccess(result.action, result.userFullName);
    } on ApiException catch (e) {
      setState(() {
        _error = e.attemptsRemaining != null && !e.locked
            ? '${e.message} (${e.attemptsRemaining} attempt(s) remaining)'
            : e.message;
        _showAdminHelp = e.locked;
      });
      _refocusOtpField();
    } catch (_) {
      setState(() => _error = 'Could not reach the server.');
      _refocusOtpField();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ---------------------------------------------------------------------
  // Kiosk-displayed QR stage (new flow: kiosk shows QR, phone scans it)
  // ---------------------------------------------------------------------

  void _stopQrTimers() {
    _qrCountdownTimer?.cancel();
    _qrPollTimer?.cancel();
    _qrSuccessTimer?.cancel();
  }

  void _startKioskQrStage() {
    setState(() {
      _stage = _KioskStage.kioskQr;
      _error = null;
    });
    _requestQrChallenge();
  }

  Future<void> _requestQrChallenge() async {
    if (_qrLoading) return;
    _stopQrTimers();
    setState(() {
      _qrLoading = true;
      _qrError = null;
      _qrConsumed = null;
    });

    try {
      final challenge = await _kioskQrService.createChallenge();
      if (!mounted || _stage != _KioskStage.kioskQr) return;
      setState(() {
        _qrChallenge = challenge;
        _qrSecondsLeft = challenge.refreshInSeconds;
        _qrLoading = false;
      });

      _qrCountdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (!mounted) return;
        setState(() => _qrSecondsLeft--);
        if (_qrSecondsLeft <= 0) {
          timer.cancel();
          _requestQrChallenge(); // auto-refresh at expiry
        }
      });

      _qrPollTimer = Timer.periodic(
        const Duration(seconds: 2),
        (_) => _pollQrStatus(challenge.challengeId),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _qrLoading = false;
        _qrError = e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _qrLoading = false;
        _qrError = 'Could not reach the server.';
      });
    }
  }

  Future<void> _pollQrStatus(String challengeId) async {
    if (!mounted || _stage != _KioskStage.kioskQr || _qrConsumed != null) {
      return;
    }
    try {
      final status = await _kioskQrService.challengeStatus(challengeId);
      if (!mounted ||
          _stage != _KioskStage.kioskQr ||
          _qrChallenge?.challengeId != challengeId) {
        return;
      }
      if (status.isConsumed) {
        _stopQrTimers();
        setState(() => _qrConsumed = status);
        // Show the confirmation briefly, then display a fresh QR.
        _qrSuccessTimer = Timer(const Duration(seconds: 3), () {
          if (mounted && _stage == _KioskStage.kioskQr) {
            _requestQrChallenge();
          }
        });
      } else if (status.isExpired) {
        _requestQrChallenge();
      }
    } catch (_) {
      // Transient poll failure: keep polling; countdown/refresh continues.
    }
  }

  /// Keep the OTP field focused after a failed attempt so the user can
  /// retype immediately (the flow stays on the OTP stage).
  void _refocusOtpField() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _stage == _KioskStage.otp) {
        _otpFocusNode.requestFocus();
      }
    });
  }

  Future<void> _scanMobileToken() async {
    final token = _mobileTokenController.text.trim();
    if (token.isEmpty) {
      setState(() => _error = 'Enter the token shown on the phone');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await _kioskService.mobileTokenScan(token);
      if (!mounted) return;
      _showSuccess(result.action, result.userFullName);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _openAdminHelp() {
    _countdownTimer?.cancel();
    setState(() {
      _stage = _KioskStage.adminVerify;
      _error = null;
      _showAdminHelp = false;
    });
  }

  Future<void> _verifyAdmin() async {
    final adminCardUid = _adminCardController.text.trim();
    if (adminCardUid.isEmpty) {
      setState(() => _error = 'Enter the admin card UID');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await _kioskService.adminVerifyCard(adminCardUid);

      // Load the employee list through the kiosk-safe endpoint (secured by
      // the verified admin card, no JWT). If it fails we fall back to
      // manual ID input.
      List<KioskEmployee>? users;
      try {
        users = await _kioskService.adminListUsers(adminCardUid);
      } catch (_) {
        users = null;
      }

      if (!mounted) return;
      setState(() {
        _stage = _KioskStage.adminActions;
        _verifiedAdminCardUid = adminCardUid;
        _verifiedAdminName = result.adminFullName;
        _kioskUsers = users;
        _error = null;
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _runAdminAction(
      Future<String?> Function(String adminCardUid, String employeeId)
          action) async {
    final adminCardUid = _verifiedAdminCardUid;
    if (adminCardUid == null) return;

    final employeeId = _employeeIdController.text.trim();
    if (employeeId.isEmpty) {
      setState(() => _error = _kioskUsers != null
          ? 'Select an employee first'
          : 'Enter the employee user ID');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final successMessage = await action(adminCardUid, employeeId);
      if (!mounted) return;
      if (successMessage != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(successMessage)),
        );
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not reach the server.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _clearLock() =>
      _runAdminAction((adminCardUid, employeeId) async {
        await _kioskService.adminClearCardLock(
          adminCardUid: adminCardUid,
          employeeUserId: employeeId,
        );
        return 'Card lock cleared';
      });

  Future<void> _manualClock(String action) =>
      _runAdminAction((adminCardUid, employeeId) async {
        final reason = _reasonController.text.trim();
        if (reason.isEmpty) {
          setState(() => _error = 'Reason is required');
          return null;
        }
        final result = await _kioskService.adminManualClock(
          adminCardUid: adminCardUid,
          employeeUserId: employeeId,
          action: action,
          reason: reason,
        );
        if (mounted) {
          _showSuccess(result.action, result.userFullName);
        }
        return null;
      });

  // ---------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Reception Kiosk'),
        actions: [
          IconButton(
            icon: const Icon(Icons.restart_alt),
            tooltip: 'Reset',
            onPressed: _reset,
          ),
        ],
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_error != null) ...[
                  Card(
                    color: Theme.of(context).colorScheme.errorContainer,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onErrorContainer,
                          fontSize: 16,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                if (_showAdminHelp) ...[
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _openAdminHelp,
                    icon: const Icon(Icons.support_agent),
                    label: const Text('Admin Help'),
                  ),
                  const SizedBox(height: 12),
                ],
                ..._buildStage(),
              ],
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _buildStage() {
    switch (_stage) {
      case _KioskStage.waiting:
        return _buildWaiting();
      case _KioskStage.otp:
        return _buildOtp();
      case _KioskStage.success:
        return _buildSuccess();
      case _KioskStage.adminVerify:
        return _buildAdminVerify();
      case _KioskStage.adminActions:
        return _buildAdminActions();
      case _KioskStage.mobileToken:
        return _buildMobileToken();
      case _KioskStage.kioskQr:
        return _buildKioskQr();
    }
  }

  List<Widget> _buildWaiting() {
    return [
      Center(
        child: ClipRRect(
          borderRadius: BorderRadius.circular(20),
          child: Image.asset(
            'assets/branding/app_logo.png',
            width:
                (MediaQuery.of(context).size.width * 0.35).clamp(140.0, 200.0),
            fit: BoxFit.contain,
            semanticLabel: 'Marfields Attendance App logo',
          ),
        ),
      ),
      const SizedBox(height: 20),
      const Icon(Icons.contactless, size: 96),
      const SizedBox(height: 16),
      Text(
        'Scan your card',
        textAlign: TextAlign.center,
        style: Theme.of(context).textTheme.headlineSmall,
      ),
      const SizedBox(height: 8),
      const Text(
        'Hold your card near the reader, or type the card UID below (dev).',
        textAlign: TextAlign.center,
      ),
      const SizedBox(height: 24),
      TextField(
        controller: _cardController,
        autofocus: true,
        textAlign: TextAlign.center,
        decoration: const InputDecoration(
          labelText: 'Card UID',
          hintText: 'e.g. TESTCARD001',
          border: OutlineInputBorder(),
        ),
        onSubmitted: (_) => _busy ? null : _scanCard(),
      ),
      const SizedBox(height: 16),
      FilledButton.icon(
        onPressed: _busy ? null : _scanCard,
        icon: _busy
            ? const SizedBox(
                height: 18,
                width: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.credit_card),
        label: const Text('Scan Card'),
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 20),
          textStyle: const TextStyle(fontSize: 18),
        ),
      ),
      if (enableKioskDisplayedQr) ...[
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: _busy ? null : _startKioskQrStage,
          icon: const Icon(Icons.qr_code_2),
          label: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Display QR for Clocking'),
              Text(
                'Employees scan this QR with the Attendance mobile app',
                style: TextStyle(fontSize: 11),
              ),
            ],
          ),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 16),
          ),
        ),
      ],
      if (enableLegacyKioskEmployeeQrScan) ...[
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: _busy
              ? null
              : () => setState(() {
                    _stage = _KioskStage.mobileToken;
                    _error = null;
                  }),
          icon: const Icon(Icons.smartphone),
          label: const Text('Mobile Token'),
          style: OutlinedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 16),
          ),
        ),
      ],
    ];
  }

  List<Widget> _buildKioskQr() {
    // Success confirmation (shown ~3s, then a fresh QR appears).
    final consumed = _qrConsumed;
    if (consumed != null) {
      final isIn = consumed.action == 'CLOCK_IN';
      return [
        Icon(
          isIn ? Icons.login : Icons.logout,
          size: 96,
          color: Colors.green.shade600,
        ),
        const SizedBox(height: 16),
        Text(
          isIn ? 'Clocked in' : 'Clocked out',
          textAlign: TextAlign.center,
          style: Theme.of(context)
              .textTheme
              .headlineMedium
              ?.copyWith(color: Colors.green.shade700),
        ),
        if (consumed.employeeName != null) ...[
          const SizedBox(height: 8),
          Text(
            consumed.employeeName!,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge,
          ),
        ],
        if (consumed.time != null) ...[
          const SizedBox(height: 4),
          Text(
            _formatQrTime(consumed.time!),
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey.shade600),
          ),
        ],
      ];
    }

    // Error / retry state.
    if (_qrError != null) {
      return [
        Icon(Icons.wifi_off, size: 72, color: Colors.red.shade400),
        const SizedBox(height: 16),
        Text(_qrError!, textAlign: TextAlign.center),
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: _qrLoading ? null : _requestQrChallenge,
          icon: const Icon(Icons.refresh),
          label: const Text('Try Again'),
        ),
        const SizedBox(height: 12),
        TextButton(onPressed: _reset, child: const Text('Back')),
      ];
    }

    final challenge = _qrChallenge;
    return [
      Text(
        'Scan to Clock In / Out',
        textAlign: TextAlign.center,
        style: Theme.of(context).textTheme.headlineSmall,
      ),
      const SizedBox(height: 8),
      const Text(
        'Open the Attendance app on your phone and tap "Scan Kiosk QR".',
        textAlign: TextAlign.center,
      ),
      const SizedBox(height: 24),
      Center(
        child: Container(
          width: 320,
          height: 320,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white,
            border: Border.all(color: Colors.indigo.shade200, width: 2),
            borderRadius: BorderRadius.circular(16),
          ),
          child: (_qrLoading || challenge == null)
              ? const Center(child: CircularProgressIndicator())
              : QrImageView(
                  data: challenge.qrPayload,
                  version: QrVersions.auto,
                  gapless: true,
                  backgroundColor: Colors.white,
                ),
        ),
      ),
      const SizedBox(height: 16),
      if (challenge != null && !_qrLoading) ...[
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: LinearProgressIndicator(
            value: challenge.refreshInSeconds == 0
                ? 0
                : (_qrSecondsLeft / challenge.refreshInSeconds).clamp(0.0, 1.0),
            minHeight: 8,
            color: _qrSecondsLeft <= 5 ? Colors.orange.shade700 : Colors.indigo,
            backgroundColor: Colors.grey.shade200,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'New code in $_qrSecondsLeft s',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 12,
            color: _qrSecondsLeft <= 5
                ? Colors.orange.shade800
                : Colors.grey.shade600,
          ),
        ),
      ],
      const SizedBox(height: 16),
      TextButton(onPressed: _reset, child: const Text('Back')),
    ];
  }

  String _formatQrTime(DateTime dt) {
    final local = dt.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)}/${local.year} '
        '${two(local.hour)}:${two(local.minute)}';
  }

  List<Widget> _buildMobileToken() {
    return [
      Icon(Icons.smartphone, size: 72, color: Colors.indigo.shade400),
      const SizedBox(height: 12),
      Text(
        'Mobile Token',
        textAlign: TextAlign.center,
        style: Theme.of(context).textTheme.headlineSmall,
      ),
      const SizedBox(height: 8),
      const Text(
        'On your phone open "Send Token to Scanner" and enter the token '
        'shown there. (QR camera scanning coming soon.)',
        textAlign: TextAlign.center,
      ),
      const SizedBox(height: 24),
      TextField(
        controller: _mobileTokenController,
        autofocus: true,
        textAlign: TextAlign.center,
        style: const TextStyle(fontFamily: 'monospace'),
        decoration: const InputDecoration(
          labelText: 'Mobile Token',
          hintText: 'Paste or type the token from the phone',
          border: OutlineInputBorder(),
        ),
        onSubmitted: (_) => _busy ? null : _scanMobileToken(),
      ),
      const SizedBox(height: 16),
      FilledButton.icon(
        onPressed: _busy ? null : _scanMobileToken,
        icon: _busy
            ? const SizedBox(
                height: 18,
                width: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.login),
        label: const Text('Validate Token'),
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 20),
          textStyle: const TextStyle(fontSize: 18),
        ),
      ),
      const SizedBox(height: 12),
      TextButton(onPressed: _reset, child: const Text('Cancel')),
    ];
  }

  List<Widget> _buildOtp() {
    final expired = _secondsLeft <= 0;
    return [
      Icon(Icons.sms_outlined, size: 72, color: Colors.indigo.shade400),
      const SizedBox(height: 12),
      Text(
        _otpAction == 'CLOCK_IN' ? 'Clocking In' : 'Clocking Out',
        textAlign: TextAlign.center,
        style: Theme.of(context).textTheme.headlineSmall,
      ),
      const SizedBox(height: 8),
      Text(
        expired
            ? 'OTP expired. Press Reset and scan again.'
            : 'Enter the OTP code · expires in $_secondsLeft s',
        textAlign: TextAlign.center,
        style: TextStyle(
          color: expired
              ? Theme.of(context).colorScheme.error
              : (_secondsLeft <= 10 ? Colors.orange.shade800 : null),
          fontWeight: _secondsLeft <= 10 ? FontWeight.bold : null,
        ),
      ),
      if (_devOtpCode != null) ...[
        const SizedBox(height: 8),
        Text(
          'DEV OTP: $_devOtpCode',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Colors.grey.shade600,
            fontFamily: 'monospace',
          ),
        ),
      ],
      const SizedBox(height: 24),
      TextField(
        controller: _otpController,
        focusNode: _otpFocusNode,
        keyboardType: TextInputType.number,
        textInputAction: TextInputAction.done,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        textAlign: TextAlign.center,
        maxLength: 4,
        style: const TextStyle(fontSize: 28, letterSpacing: 12),
        decoration: const InputDecoration(
          labelText: 'OTP Code',
          border: OutlineInputBorder(),
          counterText: '',
        ),
        onSubmitted: (_) => (_busy || expired) ? null : _verifyOtp(),
      ),
      const SizedBox(height: 16),
      FilledButton(
        onPressed: (_busy || expired) ? null : _verifyOtp,
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 20),
          textStyle: const TextStyle(fontSize: 18),
        ),
        child: _busy
            ? const SizedBox(
                height: 18,
                width: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Text('Verify OTP'),
      ),
      const SizedBox(height: 12),
      TextButton(onPressed: _reset, child: const Text('Cancel')),
    ];
  }

  List<Widget> _buildSuccess() {
    final isIn = _successAction == 'CLOCK_IN';
    return [
      Icon(
        isIn ? Icons.login : Icons.logout,
        size: 96,
        color: Colors.green.shade600,
      ),
      const SizedBox(height: 16),
      Text(
        isIn ? 'Clocked In' : 'Clocked Out',
        textAlign: TextAlign.center,
        style: Theme.of(context)
            .textTheme
            .headlineMedium
            ?.copyWith(color: Colors.green.shade700),
      ),
      if (_successName != null) ...[
        const SizedBox(height: 8),
        Text(
          _successName!,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.titleLarge,
        ),
      ],
      const SizedBox(height: 24),
      OutlinedButton(
        onPressed: _reset,
        child: const Text('Back to Kiosk'),
      ),
    ];
  }

  List<Widget> _buildAdminVerify() {
    return [
      const Icon(Icons.admin_panel_settings, size: 72),
      const SizedBox(height: 12),
      Text(
        'Admin Verification',
        textAlign: TextAlign.center,
        style: Theme.of(context).textTheme.headlineSmall,
      ),
      const SizedBox(height: 8),
      const Text(
        'Scan or type the admin card UID.',
        textAlign: TextAlign.center,
      ),
      const SizedBox(height: 24),
      TextField(
        controller: _adminCardController,
        autofocus: true,
        textAlign: TextAlign.center,
        decoration: const InputDecoration(
          labelText: 'Admin Card UID',
          hintText: 'e.g. ADMINCARD001',
          border: OutlineInputBorder(),
        ),
        onSubmitted: (_) => _busy ? null : _verifyAdmin(),
      ),
      const SizedBox(height: 16),
      FilledButton(
        onPressed: _busy ? null : _verifyAdmin,
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 20),
        ),
        child: _busy
            ? const SizedBox(
                height: 18,
                width: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Text('Verify Admin'),
      ),
      const SizedBox(height: 12),
      TextButton(onPressed: _reset, child: const Text('Cancel')),
    ];
  }

  List<Widget> _buildAdminActions() {
    return [
      const Icon(Icons.verified_user, size: 72, color: Colors.green),
      const SizedBox(height: 12),
      Text(
        'Admin: ${_verifiedAdminName ?? ''}',
        textAlign: TextAlign.center,
        style: Theme.of(context).textTheme.headlineSmall,
      ),
      const SizedBox(height: 24),
      ..._buildEmployeeSelector(),
      const SizedBox(height: 16),
      TextField(
        controller: _reasonController,
        decoration: const InputDecoration(
          labelText: 'Reason',
          border: OutlineInputBorder(),
        ),
      ),
      const SizedBox(height: 24),
      OutlinedButton.icon(
        onPressed: _busy ? null : _clearLock,
        icon: const Icon(Icons.lock_open),
        label: const Text('Clear Employee Lock'),
      ),
      const SizedBox(height: 12),
      FilledButton.icon(
        onPressed: _busy ? null : () => _manualClock('CLOCK_IN'),
        icon: const Icon(Icons.login),
        label: const Text('Manual Clock In'),
      ),
      const SizedBox(height: 12),
      FilledButton.icon(
        onPressed: _busy ? null : () => _manualClock('CLOCK_OUT'),
        icon: const Icon(Icons.logout),
        label: const Text('Manual Clock Out'),
        style: FilledButton.styleFrom(backgroundColor: Colors.red.shade700),
      ),
      const SizedBox(height: 12),
      if (_busy)
        const Center(child: CircularProgressIndicator())
      else
        TextButton(onPressed: _reset, child: const Text('Back to Kiosk')),
    ];
  }

  /// Employee selector: a tappable field that opens a searchable popup with
  /// all active employees. Falls back to manual ID input only if the
  /// employee list could not be loaded.
  List<Widget> _buildEmployeeSelector() {
    if (_kioskUsers == null) {
      return [
        TextField(
          controller: _employeeIdController,
          decoration: const InputDecoration(
            labelText: 'Employee User ID',
            hintText: 'Paste the employee user ID',
            border: OutlineInputBorder(),
            helperText:
                'Employee list could not be loaded — enter the ID manually',
          ),
        ),
      ];
    }

    final hasSelection = _selectedEmployeeName != null;
    return [
      Card(
        margin: EdgeInsets.zero,
        color: hasSelection ? Colors.indigo.shade50 : null,
        child: ListTile(
          leading: Icon(
            hasSelection ? Icons.person : Icons.person_search,
            color: hasSelection ? Colors.indigo : null,
          ),
          title: Text(
            hasSelection ? _selectedEmployeeName! : 'Select employee',
            style: TextStyle(
              fontWeight: hasSelection ? FontWeight.bold : null,
            ),
          ),
          subtitle: Text(hasSelection
              ? 'Tap to change'
              : 'Tap to choose from the employee list'),
          trailing: hasSelection
              ? IconButton(
                  icon: const Icon(Icons.close),
                  tooltip: 'Clear selection',
                  onPressed: () => setState(() {
                    _selectedEmployeeName = null;
                    _employeeIdController.clear();
                  }),
                )
              : const Icon(Icons.arrow_drop_down),
          onTap: _busy ? null : _openEmployeePicker,
        ),
      ),
    ];
  }

  Future<void> _openEmployeePicker() async {
    final users = _kioskUsers;
    if (users == null) return;

    final selected = await showDialog<KioskEmployee>(
      context: context,
      builder: (dialogContext) {
        String search = '';
        return StatefulBuilder(
          builder: (context, setDialogState) {
            final query = search.trim().toLowerCase();
            final filtered = query.isEmpty
                ? users
                : users
                    .where((u) =>
                        u.fullName.toLowerCase().contains(query) ||
                        (u.employeeCode ?? '').toLowerCase().contains(query))
                    .toList();

            return AlertDialog(
              title: const Text('Select Employee'),
              contentPadding: const EdgeInsets.fromLTRB(24, 16, 24, 0),
              content: SizedBox(
                width: 400,
                height: 420,
                child: Column(
                  children: [
                    TextField(
                      autofocus: true,
                      decoration: const InputDecoration(
                        labelText: 'Search by name',
                        prefixIcon: Icon(Icons.search),
                        border: OutlineInputBorder(),
                      ),
                      onChanged: (v) => setDialogState(() => search = v),
                    ),
                    const SizedBox(height: 12),
                    Expanded(
                      child: filtered.isEmpty
                          ? const Center(child: Text('No matching employees'))
                          : ListView.builder(
                              itemCount: filtered.length,
                              itemBuilder: (context, index) {
                                final user = filtered[index];
                                final details = [
                                  if (user.employeeCode != null &&
                                      user.employeeCode!.isNotEmpty)
                                    user.employeeCode!,
                                  if (user.department != null &&
                                      user.department!.isNotEmpty)
                                    user.department!,
                                ].join(' · ');
                                return ListTile(
                                  leading: CircleAvatar(
                                    child: Text(user.fullName.isNotEmpty
                                        ? user.fullName[0].toUpperCase()
                                        : '?'),
                                  ),
                                  title: Text(user.fullName),
                                  subtitle:
                                      details.isEmpty ? null : Text(details),
                                  trailing: user.cardOtpLocked
                                      ? Tooltip(
                                          message: 'Card OTP locked',
                                          child: Icon(Icons.lock,
                                              color: Colors.red.shade700),
                                        )
                                      : null,
                                  onTap: () =>
                                      Navigator.of(dialogContext).pop(user),
                                );
                              },
                            ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text('Cancel'),
                ),
              ],
            );
          },
        );
      },
    );

    if (selected != null && mounted) {
      setState(() {
        _employeeIdController.text = selected.id;
        _selectedEmployeeName = selected.fullName;
        _error = null;
      });
    }
  }
}
