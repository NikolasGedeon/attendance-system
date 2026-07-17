import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Twilio } from 'twilio';

/** Parsed result of a Cyta Web SMS API call. */
export interface CytaSendResult {
  /** Normalized 8-digit recipient, e.g. 96660416 */
  to: string;
  /** <status> value from the response; '0' = success */
  status: string | null;
  /** <lot> value from the response (batch id), if present */
  lot: string | null;
  /** Raw XML response body */
  raw: string;
  ok: boolean;
}

/**
 * SMS sending with switchable provider.
 *
 * Environment variables (values are trimmed and surrounding quotes are
 * stripped, so both KEY=value and KEY="value" work):
 * - SMS_ENABLED=true|false      -> master switch; when false, nothing is sent
 * - SMS_PROVIDER=cyta|twilio    -> active provider (default: cyta)
 * - SMS_DEV_SHOW_CODE=true      -> keep devOtpCode in API responses (testing)
 *
 * Cyta Web SMS API:
 * - CYTA_SMS_URL                -> API endpoint
 * - CYTA_SMS_USERNAME           -> account username
 * - CYTA_SMS_SECRET_KEY         -> secret key (never logged)
 * - CYTA_SMS_LANGUAGE           -> message language tag (default: en)
 * - CYTA_SMS_DEBUG=true         -> log generated XML with the secret key
 *                                  and OTP code masked
 *
 * Twilio (kept as fallback provider):
 * - TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  private twilioClient: Twilio | null = null;

  // -------------------------------------------------------------------
  // Environment handling
  // -------------------------------------------------------------------

  /** Reads an env var, trims it, and strips surrounding quotes. */
  private cleanEnv(name: string): string | undefined {
    const raw = process.env[name];
    if (raw === undefined) return undefined;

    let value = raw.trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1).trim();
    }
    return value === '' ? undefined : value;
  }

  get smsEnabled(): boolean {
    return this.cleanEnv('SMS_ENABLED') === 'true';
  }

  get devShowCode(): boolean {
    return this.cleanEnv('SMS_DEV_SHOW_CODE') === 'true';
  }

  get provider(): string {
    return (this.cleanEnv('SMS_PROVIDER') || 'cyta').toLowerCase();
  }

  private get cytaDebug(): boolean {
    return this.cleanEnv('CYTA_SMS_DEBUG') === 'true';
  }

  // -------------------------------------------------------------------
  // OTP entry point (used by KioskService)
  // -------------------------------------------------------------------

  /**
   * Sends the attendance OTP by SMS. No-op when SMS_ENABLED=false.
   *
   * Throws BadRequestException with:
   * - a specific message for missing phone / invalid Cyprus number /
   *   missing provider configuration,
   * - a generic message for transport or provider failures (the real
   *   cause is logged; the OTP code and secret key never are).
   */
  async sendOtp(
    phoneNumber: string,
    code: string,
    expiresInSeconds: number,
  ): Promise<void> {
    if (!this.smsEnabled) {
      return;
    }

    if (!phoneNumber || !phoneNumber.trim()) {
      throw new BadRequestException(
        'User has no phone number for SMS OTP. Please contact admin.',
      );
    }

    const message =
      `Your attendance code is ${code}. ` +
      `It expires in ${expiresInSeconds} seconds.`;

    try {
      if (this.provider === 'cyta') {
        const result = await this.sendCytaRaw(phoneNumber, message, {
          maskInDebugLog: code,
        });
        if (!result.ok) {
          this.logger.error(
            `Cyta returned status=${result.status ?? 'unknown'} ` +
              `(to=${result.to}, body=${this.truncate(result.raw, 300)})`,
          );
          throw new BadRequestException(
            'Could not send SMS OTP. Please try again or contact admin.',
          );
        }
        this.logger.log(
          `OTP SMS sent via cyta to ***${result.to.slice(-2)} ` +
            `(status=${result.status}, lot=${result.lot ?? '-'})`,
        );
      } else {
        await this.sendTwilioRaw(phoneNumber, message);
        this.logger.log(
          `OTP SMS sent via twilio to ${this.maskNumber(phoneNumber)}`,
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`SMS send failed (${this.provider}): ${detail}`);
      throw new BadRequestException(
        'Could not send SMS OTP. Please try again or contact admin.',
      );
    }
  }

  // -------------------------------------------------------------------
  // Cyta Web SMS API
  // -------------------------------------------------------------------

  /**
   * Low-level Cyta send. Returns the parsed result (including non-0
   * statuses) so callers can decide what to do; throws only for
   * configuration problems, invalid numbers, or transport errors.
   */
  async sendCytaRaw(
    phoneNumber: string,
    message: string,
    options: { maskInDebugLog?: string } = {},
  ): Promise<CytaSendResult> {
    const url =
      this.cleanEnv('CYTA_SMS_URL') ||
      'https://www.cyta.com.cy/cytamobilevodafone/dev/websmsapi/sendsms.aspx';
    const username = this.cleanEnv('CYTA_SMS_USERNAME');
    const secretKey = this.cleanEnv('CYTA_SMS_SECRET_KEY');
    const language = this.cleanEnv('CYTA_SMS_LANGUAGE') || 'en';

    if (!username || !secretKey) {
      this.logger.error(
        'SMS_PROVIDER=cyta but CYTA_SMS_USERNAME / CYTA_SMS_SECRET_KEY are missing',
      );
      throw new BadRequestException(
        'SMS provider is not configured correctly. Please contact admin.',
      );
    }

    const to = this.normalizeCyprusMobile(phoneNumber);
    const xml = this.buildCytaXml({
      username,
      secretKey,
      mobile: to,
      message,
      language,
    });

    if (this.cytaDebug) {
      // Mask the secret key and (if provided) the OTP code.
      let debugXml = xml.replace(
        /<secretkey>[\s\S]*?<\/secretkey>/,
        '<secretkey>***MASKED***</secretkey>',
      );
      if (options.maskInDebugLog) {
        debugXml = debugXml.split(options.maskInDebugLog).join('****');
      }
      this.logger.debug(`Cyta request (to=${to}):\n${debugXml}`);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: xml,
    });

    const raw = await response.text();

    if (!response.ok) {
      throw new Error(
        `Cyta HTTP ${response.status}: ${this.truncate(raw, 300)}`,
      );
    }

    const status = this.extractTag(raw, 'status');
    const lot = this.extractTag(raw, 'lot');

    if (this.cytaDebug) {
      this.logger.debug(
        `Cyta response (to=${to}): status=${status ?? 'none'} ` +
          `lot=${lot ?? 'none'} body=${this.truncate(raw, 300)}`,
      );
    }

    return {
      to,
      status,
      lot,
      raw,
      ok: status === '0',
    };
  }

  private buildCytaXml(params: {
    username: string;
    secretKey: string;
    mobile: string;
    message: string;
    language: string;
  }): string {
    const esc = this.escapeXml.bind(this);
    return (
      '<?xml version="1.0" encoding="UTF-8" ?>\n' +
      '<websmsapi>\n' +
      '  <version>1.0</version>\n' +
      `  <username>${esc(params.username)}</username>\n` +
      `  <secretkey>${esc(params.secretKey)}</secretkey>\n` +
      '  <recipients>\n' +
      '    <count>1</count>\n' +
      '    <mobiles>\n' +
      `      <m>${esc(params.mobile)}</m>\n` +
      '    </mobiles>\n' +
      '  </recipients>\n' +
      `  <message>${esc(params.message)}</message>\n` +
      `  <language>${esc(params.language)}</language>\n` +
      '</websmsapi>'
    );
  }

  /**
   * Accepts +35796660416, 0035796660416 or 96660416 and returns 96660416.
   * After normalization the number must be exactly 8 digits starting with 9.
   */
  private normalizeCyprusMobile(phoneNumber: string): string {
    let digits = phoneNumber.trim().replace(/[\s\-()]/g, '');

    if (digits.startsWith('+')) {
      digits = digits.slice(1);
    }
    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    }
    if (digits.startsWith('357')) {
      digits = digits.slice(3);
    }

    if (!/^9\d{7}$/.test(digits)) {
      throw new BadRequestException(
        'Invalid Cyprus mobile number for SMS OTP.',
      );
    }

    return digits;
  }

  /** Extracts the text content of a simple XML tag, e.g. <status>0</status>. */
  private extractTag(xml: string, tag: string): string | null {
    const match = xml.match(
      new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`, 'i'),
    );
    return match ? match[1] : null;
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // -------------------------------------------------------------------
  // Twilio (fallback provider, SMS_PROVIDER=twilio)
  // -------------------------------------------------------------------

  private getTwilioClient(): Twilio {
    if (this.twilioClient) {
      return this.twilioClient;
    }

    const accountSid = this.cleanEnv('TWILIO_ACCOUNT_SID');
    const authToken = this.cleanEnv('TWILIO_AUTH_TOKEN');

    if (!accountSid || !authToken) {
      this.logger.error(
        'SMS_PROVIDER=twilio but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are missing',
      );
      throw new BadRequestException(
        'SMS provider is not configured correctly. Please contact admin.',
      );
    }

    this.twilioClient = new Twilio(accountSid, authToken);
    return this.twilioClient;
  }

  /** Low-level Twilio send. Throws raw Twilio errors. */
  async sendTwilioRaw(to: string, body: string) {
    const from = this.cleanEnv('TWILIO_FROM_NUMBER');
    if (!from) {
      this.logger.error('SMS_PROVIDER=twilio but TWILIO_FROM_NUMBER is missing');
      throw new BadRequestException(
        'SMS provider is not configured correctly. Please contact admin.',
      );
    }

    return this.getTwilioClient().messages.create({ to, from, body });
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  private maskNumber(phoneNumber: string): string {
    const digits = phoneNumber.replace(/\D/g, '');
    return digits.length >= 2 ? `***${digits.slice(-2)}` : '***';
  }

  private truncate(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max)}...` : value;
  }
}
