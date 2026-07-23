import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * Reusable email service with switchable provider.
 *
 * Environment variables:
 * - EMAIL_PROVIDER=graph|smtp   (default: graph — the production path)
 *
 * Microsoft Graph (client credentials; works with MFA/Conditional Access
 * because no user or mailbox password is involved):
 * - AZURE_TENANT_ID
 * - AZURE_CLIENT_ID
 * - AZURE_CLIENT_SECRET          (never logged)
 * - EMAIL_FROM                   sender mailbox, e.g. attendance@marfields.com
 *
 * SMTP (optional fallback only, NOT required when EMAIL_PROVIDER=graph):
 * - SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USERNAME / SMTP_PASSWORD
 *
 * Common:
 * - PASSWORD_RESET_URL           default https://attendance.marfields.com/reset-password
 *
 * Logging policy: client secret, access tokens, reset tokens, authorization
 * headers, recipient addresses and message bodies are never logged. Graph
 * failures log only the HTTP status and the sanitized Graph error code.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  /** In-memory Graph token cache. */
  private graphToken: { value: string; expiresAtMs: number } | null = null;

  private env(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value === '' ? undefined : value;
  }

  get provider(): string {
    return (this.env('EMAIL_PROVIDER') || 'graph').toLowerCase();
  }

  get resetUrlBase(): string {
    return (
      this.env('PASSWORD_RESET_URL') ||
      'https://attendance.marfields.com/reset-password'
    );
  }

  /** Bare sender address for Graph (strips a "Name <address>" display form). */
  private get senderAddress(): string {
    const raw = this.env('EMAIL_FROM') || 'attendance@marfields.com';
    const match = raw.match(/<([^>]+)>/);
    return (match ? match[1] : raw).trim();
  }

  // -------------------------------------------------------------------
  // Account activation (Stage 3) — welcome email
  // -------------------------------------------------------------------

  /**
   * Activation link base, from ATTENDANCE_ACTIVATION_URL or derived from
   * ATTENDANCE_WEB_URL (…/activate-account). Undefined when neither is set.
   */
  get activationUrlBase(): string | undefined {
    const explicit = this.env('ATTENDANCE_ACTIVATION_URL');
    if (explicit) return explicit;
    const web = this.env('ATTENDANCE_WEB_URL');
    if (web) return `${web.replace(/\/+$/, '')}/activate-account`;
    return undefined;
  }

  /** True when an activation link can be built (used by callers to pre-check). */
  get activationConfigured(): boolean {
    return !!this.activationUrlBase;
  }

  /**
   * Sends the branded welcome / account-activation email (HTML + plain text).
   * The raw token and the tokenized link are NEVER logged.
   * Throws when the activation URL is not configured so the caller can mark
   * onboarding EMAIL_FAILED with a safe reason.
   */
  async sendWelcomeActivationEmail(
    to: string,
    fullName: string,
    rawToken: string,
    expiresInHours: number,
  ): Promise<void> {
    const base = this.activationUrlBase;
    if (!base) {
      throw new BadRequestException({
        code: 'ACTIVATION_URL_NOT_CONFIGURED',
        message:
          'Activation URL is not configured (set ATTENDANCE_ACTIVATION_URL or ATTENDANCE_WEB_URL).',
      });
    }
    const link = `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(rawToken)}`;
    const subject = 'Welcome to Marfields Attendance';

    const webUrl = this.env('ATTENDANCE_WEB_URL');
    const playUrl = this.env('GOOGLE_PLAY_APP_URL');
    const appleUrl = this.env('APPLE_APP_STORE_URL');
    const supportEmail = this.env('SUPPORT_EMAIL');

    // ----- plain text -----
    const textLines = [
      `Welcome to Marfields Attendance, ${fullName}.`,
      '',
      'Your attendance account has been created.',
      `Login email: ${to}`,
      '',
      `Create your password (link valid for ${expiresInHours} hours):`,
      link,
      '',
      'After setting your password you can log in normally.',
      'On mobile, allow location permission — it is required to clock in and out.',
    ];
    if (webUrl) textLines.push('', `Attendance web app: ${webUrl}`);
    if (playUrl) textLines.push(`Android app (Google Play): ${playUrl}`);
    if (appleUrl) textLines.push(`iPhone app (App Store): ${appleUrl}`);
    if (supportEmail) textLines.push('', `Need help? Contact ${supportEmail}`);
    textLines.push(
      '',
      'For your security, do not forward or share this activation link.',
    );
    const text = textLines.join('\n');

    // ----- HTML -----
    const btn = (href: string, label: string, bg: string) =>
      `<a href="${href}" style="display:inline-block;background:${bg};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;margin:4px 6px;">${label}</a>`;
    const storeButtons = [
      webUrl ? btn(webUrl, 'Open Attendance Web', '#00695c') : '',
      playUrl ? btn(playUrl, 'Get it on Google Play', '#3949ab') : '',
      appleUrl ? btn(appleUrl, 'Download on the App Store', '#111111') : '',
    ]
      .filter(Boolean)
      .join('');
    const supportBlock = supportEmail
      ? `<p style="color:#555;font-size:13px;">Need help? Contact <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`
      : '';
    const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222;">
    <h2 style="color:#00695c;margin:0 0 4px;">Marfields Attendance</h2>
    <p style="margin:0 0 16px;color:#777;font-size:13px;">Welcome aboard</p>
    <p>Hello <strong>${fullName}</strong>,</p>
    <p>Your Marfields Attendance account has been created. Your login email is
       <strong>${to}</strong>.</p>
    <p style="text-align:center;margin:24px 0;">
      ${btn(link, 'Create Password', '#00695c')}
    </p>
    <p style="color:#555;">This activation link is valid for
       <strong>${expiresInHours} hours</strong>. After you set your password you
       can log in normally.</p>
    <p style="color:#555;">On the mobile app, please <strong>allow location
       permission</strong> — it is required to clock in and out.</p>
    ${storeButtons ? `<p style="text-align:center;margin:18px 0;">${storeButtons}</p>` : ''}
    ${supportBlock}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
    <p style="color:#999;font-size:12px;">For your security, do not forward or
       share this activation link. If you did not expect this email you can
       ignore it.</p>
  </div>`;

    if (this.provider === 'graph') {
      await this.sendViaGraph(to, subject, html);
    } else {
      const from = this.env('EMAIL_FROM') || 'Attendance <no-reply@marfields.com>';
      await this.getTransporter().sendMail({ from, to, subject, text, html });
    }
  }

  // -------------------------------------------------------------------
  // Microsoft Graph (client credentials)
  // -------------------------------------------------------------------

  /**
   * Acquires (and caches) an app-only Graph access token. The cached token
   * is reused until 60 seconds before its expiry. Nothing sensitive is
   * ever logged.
   */
  private async getGraphAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.graphToken && now < this.graphToken.expiresAtMs - 60_000) {
      return this.graphToken.value;
    }

    const tenantId = this.env('AZURE_TENANT_ID');
    const clientId = this.env('AZURE_CLIENT_ID');
    const clientSecret = this.env('AZURE_CLIENT_SECRET');

    if (!tenantId || !clientId || !clientSecret) {
      this.logger.error(
        'Graph email is not configured (AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET missing)',
      );
      throw new BadRequestException('Email service is not configured.');
    }

    const response = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
      },
    );

    if (!response.ok) {
      const code = await this.extractGraphErrorCode(response);
      this.logger.error(
        `Graph token request failed: HTTP ${response.status}${code ? ` (${code})` : ''}`,
      );
      throw new Error('graph_auth_failed');
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.graphToken = {
      value: data.access_token,
      expiresAtMs: now + (data.expires_in ?? 3600) * 1000,
    };
    return this.graphToken.value;
  }

  /** Sends an HTML email via POST /users/{sender}/sendMail. */
  private async sendViaGraph(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const accessToken = await this.getGraphAccessToken();

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.senderAddress)}/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            subject,
            body: {
              contentType: 'HTML',
              content: html,
            },
            toRecipients: [{ emailAddress: { address: to } }],
          },
          saveToSentItems: true,
        }),
      },
    );

    // Success is 202 Accepted.
    if (!response.ok) {
      const code = await this.extractGraphErrorCode(response);
      this.logger.error(
        `Graph sendMail failed: HTTP ${response.status}${code ? ` (${code})` : ''}`,
      );
      // Expired/revoked cached token: drop it so the next attempt re-auths.
      if (response.status === 401) this.graphToken = null;
      throw new Error('graph_send_failed');
    }
  }

  /**
   * Extracts only the machine-readable Graph error code (e.g.
   * "ErrorAccessDenied") — never the description, headers or tokens.
   */
  private async extractGraphErrorCode(response: {
    text: () => Promise<string>;
  }): Promise<string | null> {
    try {
      const body = await response.text();
      const match = body.match(/"code"\s*:\s*"([A-Za-z0-9_.-]+)"/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------
  // SMTP (optional fallback, EMAIL_PROVIDER=smtp)
  // -------------------------------------------------------------------

  private getTransporter(): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    const host = this.env('SMTP_HOST');
    const port = Number(this.env('SMTP_PORT') || 587);
    const secure = this.env('SMTP_SECURE') === 'true';
    const user = this.env('SMTP_USERNAME');
    const pass = this.env('SMTP_PASSWORD');

    if (!host || !user || !pass) {
      this.logger.error(
        'SMTP is not configured. SMTP_HOST, SMTP_USERNAME, or SMTP_PASSWORD is missing.',
      );

      throw new BadRequestException('Email service is not configured.');
    }

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      this.logger.error('SMTP_PORT contains an invalid value.');
      throw new BadRequestException('Email service is not configured.');
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });

    return this.transporter;
  }

  // -------------------------------------------------------------------
  // Password reset email
  // -------------------------------------------------------------------

  /**
   * Sends a password-reset email.
   *
   * The raw reset token is used only to construct the reset URL.
   * It is never written to application logs.
   */
  async sendPasswordResetEmail(
    to: string,
    rawToken: string,
    expiresInMinutes: number,
  ): Promise<void> {
    const link = `${this.resetUrlBase}?token=${encodeURIComponent(rawToken)}`;
    const subject = 'Reset your Attendance App password';

    const text =
      `We received a request to reset your Attendance App password.\n\n` +
      `Open the following link to choose a new password. ` +
      `This link is valid for ${expiresInMinutes} minutes and can be used once:\n\n` +
      `${link}\n\n` +
      `If you did not request this, you can safely ignore this email. ` +
      `Your password will not be changed.`;

    const html = `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="color:#3949ab;margin-bottom:8px;">
          Reset your password
        </h2>

        <p>
          We received a request to reset your Attendance App password.
        </p>

        <p style="margin:28px 0;text-align:center;">
          <a
            href="${link}"
            style="
              background:#3949ab;
              color:#ffffff;
              text-decoration:none;
              padding:14px 32px;
              border-radius:8px;
              font-weight:bold;
              display:inline-block;
            "
          >
            Reset Password
          </a>
        </p>

        <p style="color:#555;">
          This link expires in
          <strong>${expiresInMinutes} minutes</strong>
          and can be used once.
        </p>

        <p style="color:#555;">
          If you did not request this, you can safely ignore this email.
          Your password will not be changed.
        </p>
      </div>
    `;

    if (this.provider === 'graph') {
      await this.sendViaGraph(to, subject, html);
    } else {
      const from =
        this.env('EMAIL_FROM') || 'Attendance <no-reply@marfields.com>';
      await this.getTransporter().sendMail({
        from,
        to,
        subject,
        text,
        html,
      });
    }

    this.logger.log('Password reset email sent successfully.');
  }
}
