import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * Reusable SMTP email service.
 *
 * Environment variables:
 * - EMAIL_PROVIDER=smtp
 * - SMTP_HOST
 * - SMTP_PORT
 * - SMTP_SECURE=true|false
 * - SMTP_USERNAME
 * - SMTP_PASSWORD
 * - EMAIL_FROM
 * - PASSWORD_RESET_URL
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  private env(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value === '' ? undefined : value;
  }

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

  get resetUrlBase(): string {
    return (
      this.env('PASSWORD_RESET_URL') ||
      'https://attendance.marfields.com/reset-password'
    );
  }

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
    const from =
      this.env('EMAIL_FROM') || 'Attendance <no-reply@marfields.com>';

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

    await this.getTransporter().sendMail({
      from,
      to,
      subject,
      text,
      html,
    });

    this.logger.log('Password reset email sent successfully.');
  }
}
