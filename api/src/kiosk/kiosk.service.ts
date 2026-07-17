import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AttendanceMethod,
  AttendanceOtpAction,
  Role,
} from '@prisma/client';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { AdminClearCardLockDto } from './dto/admin-clear-card-lock.dto';
import { AdminManualClockDto } from './dto/admin-manual-clock.dto';
import { AdminVerifyCardDto } from './dto/admin-verify-card.dto';
import { CardScanDto } from './dto/card-scan.dto';
import { MobileTokenScanDto } from './dto/mobile-token-scan.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Injectable()
export class KioskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly smsService: SmsService,
  ) {}

  private trim(value: string) {
    return value.trim();
  }

  private hashOtp(code: string) {
    return createHash('sha256').update(code).digest('hex');
  }

  private generateOtpCode() {
    return randomInt(1000, 10000).toString();
  }

  private async getActiveKiosk(kioskDeviceKey: string) {
    const deviceKey = this.trim(kioskDeviceKey);

    const kiosk = await this.prisma.kiosk.findUnique({
      where: {
        deviceKey,
      },
    });

    if (!kiosk || !kiosk.isActive) {
      throw new UnauthorizedException('Invalid or inactive kiosk');
    }

    return this.prisma.kiosk.update({
      where: {
        id: kiosk.id,
      },
      data: {
        lastSeenAt: new Date(),
      },
    });
  }

  private async getUserByCard(cardUid: string) {
    const cleanCardUid = this.trim(cardUid);

    const user = await this.prisma.user.findUnique({
      where: {
        cardUid: cleanCardUid,
      },
    });

    if (!user) {
      return null;
    }

    if (!user.isActive) {
      throw new BadRequestException('User is inactive');
    }

    if (user.cardDisabledAt) {
      throw new BadRequestException('Card is disabled');
    }

    if (user.cardOtpLocked) {
      throw new BadRequestException({
        message:
          'Card OTP is locked after 3 failed attempts. Please contact admin.',
        locked: true,
      });
    }

    return user;
  }

  private async getNextAction(userId: string): Promise<AttendanceOtpAction> {
    const openAttendance = await this.prisma.attendance.findFirst({
      where: {
        userId,
        clockOut: null,
      },
      orderBy: {
        clockIn: 'desc',
      },
    });

    return openAttendance
      ? AttendanceOtpAction.CLOCK_OUT
      : AttendanceOtpAction.CLOCK_IN;
  }

  private async performAttendanceAction(params: {
    userId: string;
    kioskId: string;
    action: AttendanceOtpAction;
    method: AttendanceMethod;
    notes?: string;
    isEdited?: boolean;
  }) {
    const { userId, kioskId, action, method, notes, isEdited } = params;

    if (action === AttendanceOtpAction.CLOCK_IN) {
      const openAttendance = await this.prisma.attendance.findFirst({
        where: {
          userId,
          clockOut: null,
        },
        orderBy: {
          clockIn: 'desc',
        },
      });

      if (openAttendance) {
        throw new BadRequestException('User is already clocked in');
      }

      return this.prisma.attendance.create({
        data: {
          userId,
          clockIn: new Date(),
          methodIn: method,
          kioskInId: kioskId,
          notes,
          isEdited: isEdited ?? false,
        },
      });
    }

    const openAttendance = await this.prisma.attendance.findFirst({
      where: {
        userId,
        clockOut: null,
      },
      orderBy: {
        clockIn: 'desc',
      },
    });

    if (!openAttendance) {
      throw new BadRequestException('No active clock-in record found');
    }

    return this.prisma.attendance.update({
      where: {
        id: openAttendance.id,
      },
      data: {
        clockOut: new Date(),
        methodOut: method,
        kioskOutId: kioskId,
        notes,
        isEdited: isEdited ?? openAttendance.isEdited,
      },
    });
  }

  private userResponse(user: {
    id: string;
    fullName: string;
    employeeCode: string | null;
    department: string | null;
  }) {
    return {
      id: user.id,
      fullName: user.fullName,
      employeeCode: user.employeeCode,
      department: user.department,
    };
  }

  private async createAuditLog(params: {
    actorUserId?: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, any>;
  }) {
    return this.prisma.auditLog.create({
      data: {
        actorUserId: params.actorUserId ?? null,
        action: params.action,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        metadata: params.metadata ?? {},
      },
    });
  }

  private async incrementOtpFailure(userId: string) {
    const updatedUser = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        cardOtpFailedCount: {
          increment: 1,
        },
      },
      select: {
        id: true,
        cardOtpFailedCount: true,
      },
    });

    if (updatedUser.cardOtpFailedCount >= 3) {
      await this.prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          cardOtpLocked: true,
        },
      });

      await this.createAuditLog({
        actorUserId: null,
        action: 'CARD_OTP_LOCKED',
        entityType: 'User',
        entityId: userId,
        metadata: {
          failedCount: updatedUser.cardOtpFailedCount,
        },
      });

      return {
        locked: true,
        failedCount: updatedUser.cardOtpFailedCount,
        attemptsRemaining: 0,
      };
    }

    return {
      locked: false,
      failedCount: updatedUser.cardOtpFailedCount,
      attemptsRemaining: Math.max(0, 3 - updatedUser.cardOtpFailedCount),
    };
  }

  async cardScan(dto: CardScanDto) {
    const cardUid = this.trim(dto.cardUid);
    const kioskDeviceKey = this.trim(dto.kioskDeviceKey);

    const kiosk = await this.getActiveKiosk(kioskDeviceKey);
    const user = await this.getUserByCard(cardUid);

    if (!user) {
      await this.createAuditLog({
        actorUserId: null,
        action: 'CARD_SCAN_UNKNOWN',
        entityType: 'User',
        entityId: null,
        metadata: {
          cardUid,
          kioskDeviceKey,
          kioskId: kiosk.id,
        },
      });

      throw new NotFoundException('Card is not registered');
    }

    const action = await this.getNextAction(user.id);

    if (user.requireOtpForCard) {
      // 120s: real SMS delivery can take a while; 30s was too tight.
      const expiresInSeconds = 120;

      // When SMS is enabled the user must have a phone number,
      // checked before creating the OTP so no orphan request is stored.
      if (this.smsService.smsEnabled && !user.phoneNumber) {
        throw new BadRequestException(
          'User has no phone number for SMS OTP. Please contact admin.',
        );
      }

      const code = this.generateOtpCode();
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

      const otp = await this.prisma.attendanceOtp.create({
        data: {
          userId: user.id,
          kioskId: kiosk.id,
          cardUid,
          codeHash: this.hashOtp(code),
          action,
          expiresAt,
        },
      });

      await this.createAuditLog({
        actorUserId: user.id,
        action: 'CARD_OTP_CREATED',
        entityType: 'AttendanceOtp',
        entityId: otp.id,
        metadata: {
          action,
          kioskId: kiosk.id,
          expiresAt,
          smsEnabled: this.smsService.smsEnabled,
        },
      });

      if (this.smsService.smsEnabled) {
        // Throws a user-friendly BadRequestException on Twilio failure.
        await this.smsService.sendOtp(
          user.phoneNumber as string,
          code,
          expiresInSeconds,
        );

        await this.createAuditLog({
          actorUserId: user.id,
          action: 'CARD_OTP_SMS_SENT',
          entityType: 'AttendanceOtp',
          entityId: otp.id,
          metadata: {
            kioskId: kiosk.id,
          },
        });
      }

      // devOtpCode is only exposed when SMS is disabled (local testing)
      // or explicitly requested via SMS_DEV_SHOW_CODE=true.
      const showDevCode =
        !this.smsService.smsEnabled || this.smsService.devShowCode;

      return {
        success: true,
        requiresOtp: true,
        otpRequestId: otp.id,
        expiresInSeconds,
        action,
        ...(showDevCode && { devOtpCode: code }),
        message: this.smsService.smsEnabled
          ? 'OTP sent by SMS.'
          : 'OTP required.',
      };
    }

    const attendance = await this.performAttendanceAction({
      userId: user.id,
      kioskId: kiosk.id,
      action,
      method: AttendanceMethod.CARD,
    });

    await this.createAuditLog({
      actorUserId: user.id,
      action:
        action === AttendanceOtpAction.CLOCK_IN
          ? 'CLOCK_IN_CARD'
          : 'CLOCK_OUT_CARD',
      entityType: 'Attendance',
      entityId: attendance.id,
      metadata: {
        kioskId: kiosk.id,
        cardUid,
      },
    });

    return {
      success: true,
      action,
      user: this.userResponse(user),
      attendance,
    };
  }

  /**
   * Clock in/out with a rotating mobile token (NOT the physical card UID).
   * The phone generates the token via POST /mobile-token/generate (JWT);
   * the kiosk validates it here using its device key.
   */
  async mobileTokenScan(dto: MobileTokenScanDto) {
    const rawToken = this.trim(dto.token);
    const kioskDeviceKey = this.trim(dto.kioskDeviceKey);

    const kiosk = await this.getActiveKiosk(kioskDeviceKey);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const now = new Date();
    const tokenRecord = await this.prisma.mobileAttendanceToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: now },
      },
      include: { user: true },
    });

    if (!tokenRecord) {
      await this.createAuditLog({
        actorUserId: null,
        action: 'MOBILE_TOKEN_SCAN_INVALID',
        entityType: 'Kiosk',
        entityId: kiosk.id,
        metadata: { kioskId: kiosk.id },
      });
      throw new BadRequestException(
        'Invalid or expired mobile token. Please refresh the token on your phone and try again.',
      );
    }

    const user = tokenRecord.user;
    if (!user.isActive) {
      throw new BadRequestException('User is inactive');
    }

    // Single use: mark consumed before performing the action.
    await this.prisma.mobileAttendanceToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: now },
    });

    const action = await this.getNextAction(user.id);

    const attendance = await this.performAttendanceAction({
      userId: user.id,
      kioskId: kiosk.id,
      action,
      method: AttendanceMethod.MOBILE_QR,
    });

    await this.createAuditLog({
      actorUserId: user.id,
      action:
        action === AttendanceOtpAction.CLOCK_IN
          ? 'CLOCK_IN_MOBILE_TOKEN'
          : 'CLOCK_OUT_MOBILE_TOKEN',
      entityType: 'Attendance',
      entityId: attendance.id,
      metadata: { kioskId: kiosk.id, tokenId: tokenRecord.id },
    });

    return {
      success: true,
      action,
      user: this.userResponse(user),
      attendance,
      message:
        action === AttendanceOtpAction.CLOCK_IN
          ? `Clocked in: ${user.fullName}`
          : `Clocked out: ${user.fullName}`,
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const otpRequestId = this.trim(dto.otpRequestId);
    const code = this.trim(dto.code);
    const kioskDeviceKey = this.trim(dto.kioskDeviceKey);

    const kiosk = await this.getActiveKiosk(kioskDeviceKey);

    const otp = await this.prisma.attendanceOtp.findUnique({
      where: {
        id: otpRequestId,
      },
      include: {
        user: true,
      },
    });

    if (!otp) {
      throw new NotFoundException('OTP request not found');
    }

    if (otp.kioskId !== kiosk.id) {
      throw new UnauthorizedException('OTP does not belong to this kiosk');
    }

    if (otp.usedAt) {
      throw new BadRequestException('OTP has already been used');
    }

    if (!otp.user.isActive) {
      throw new BadRequestException('User is inactive');
    }

    if (otp.user.cardDisabledAt) {
      throw new BadRequestException('Card is disabled');
    }

    if (otp.user.cardOtpLocked) {
      throw new BadRequestException({
        message:
          'Card OTP is locked after 3 failed attempts. Please contact admin.',
        locked: true,
      });
    }

    const now = new Date();

    if (otp.expiresAt <= now) {
      await this.prisma.attendanceOtp.update({
        where: {
          id: otp.id,
        },
        data: {
          attempts: {
            increment: 1,
          },
        },
      });

      const failure = await this.incrementOtpFailure(otp.userId);

      throw new BadRequestException({
        message: failure.locked
          ? 'OTP failed 3 times. Please contact admin.'
          : 'OTP expired. Please scan again.',
        locked: failure.locked,
        attemptsRemaining: failure.attemptsRemaining,
      });
    }

    const codeHash = this.hashOtp(code);

    if (codeHash !== otp.codeHash) {
      await this.prisma.attendanceOtp.update({
        where: {
          id: otp.id,
        },
        data: {
          attempts: {
            increment: 1,
          },
        },
      });

      const failure = await this.incrementOtpFailure(otp.userId);

      throw new BadRequestException({
        message: failure.locked
          ? 'OTP failed 3 times. Please contact admin.'
          : 'Invalid OTP code.',
        locked: failure.locked,
        attemptsRemaining: failure.attemptsRemaining,
      });
    }

    await this.prisma.attendanceOtp.update({
      where: {
        id: otp.id,
      },
      data: {
        usedAt: now,
      },
    });

    await this.prisma.user.update({
      where: {
        id: otp.userId,
      },
      data: {
        cardOtpFailedCount: 0,
      },
    });

    const attendance = await this.performAttendanceAction({
      userId: otp.userId,
      kioskId: kiosk.id,
      action: otp.action,
      method: AttendanceMethod.CARD,
    });

    await this.createAuditLog({
      actorUserId: otp.userId,
      action:
        otp.action === AttendanceOtpAction.CLOCK_IN
          ? 'CLOCK_IN_CARD_OTP'
          : 'CLOCK_OUT_CARD_OTP',
      entityType: 'Attendance',
      entityId: attendance.id,
      metadata: {
        kioskId: kiosk.id,
        otpRequestId: otp.id,
      },
    });

    return {
      success: true,
      action: otp.action,
      user: this.userResponse(otp.user),
      attendance,
    };
  }

  private async verifyAdminCard(adminCardUid: string, kioskDeviceKey: string) {
    const cleanAdminCardUid = this.trim(adminCardUid);
    const kiosk = await this.getActiveKiosk(kioskDeviceKey);

    const admin = await this.prisma.user.findUnique({
      where: {
        cardUid: cleanAdminCardUid,
      },
    });

    if (!admin) {
      throw new UnauthorizedException('Admin card not found');
    }

    if (!admin.isActive) {
      throw new UnauthorizedException('Admin user is inactive');
    }

    if (admin.cardDisabledAt) {
      throw new UnauthorizedException('Admin card is disabled');
    }

    if (admin.role !== Role.ADMIN && admin.role !== Role.MANAGER) {
      throw new UnauthorizedException('Card does not belong to an admin');
    }

    return {
      admin,
      kiosk,
    };
  }

  async adminVerifyCard(dto: AdminVerifyCardDto) {
    const { admin, kiosk } = await this.verifyAdminCard(
      dto.adminCardUid,
      dto.kioskDeviceKey,
    );

    await this.createAuditLog({
      actorUserId: admin.id,
      action: 'ADMIN_CARD_VERIFIED',
      entityType: 'Kiosk',
      entityId: kiosk.id,
      metadata: {
        kioskId: kiosk.id,
      },
    });

    return {
      success: true,
      admin: {
        id: admin.id,
        fullName: admin.fullName,
        email: admin.email,
        role: admin.role,
        employeeCode: admin.employeeCode,
        department: admin.department,
      },
      kiosk: {
        id: kiosk.id,
        name: kiosk.name,
        location: kiosk.location,
      },
    };
  }

  async adminManualClock(dto: AdminManualClockDto) {
    const { admin, kiosk } = await this.verifyAdminCard(
      dto.adminCardUid,
      dto.kioskDeviceKey,
    );

    const employee = await this.prisma.user.findUnique({
      where: {
        id: dto.employeeUserId,
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    if (!employee.isActive) {
      throw new BadRequestException('Employee is inactive');
    }

    const action =
      dto.action === 'CLOCK_IN'
        ? AttendanceOtpAction.CLOCK_IN
        : AttendanceOtpAction.CLOCK_OUT;

    const attendance = await this.performAttendanceAction({
      userId: employee.id,
      kioskId: kiosk.id,
      action,
      method: AttendanceMethod.MANUAL,
      notes: dto.reason,
      isEdited: true,
    });

    await this.createAuditLog({
      actorUserId: admin.id,
      action:
        action === AttendanceOtpAction.CLOCK_IN
          ? 'MANUAL_CLOCK_IN_BY_ADMIN'
          : 'MANUAL_CLOCK_OUT_BY_ADMIN',
      entityType: 'Attendance',
      entityId: attendance.id,
      metadata: {
        employeeUserId: employee.id,
        reason: dto.reason,
        kioskId: kiosk.id,
      },
    });

    return {
      success: true,
      action,
      admin: {
        id: admin.id,
        fullName: admin.fullName,
        role: admin.role,
      },
      employee: this.userResponse(employee),
      attendance,
    };
  }

  async adminClearCardLock(dto: AdminClearCardLockDto) {
    const { admin, kiosk } = await this.verifyAdminCard(
      dto.adminCardUid,
      dto.kioskDeviceKey,
    );

    const employee = await this.prisma.user.findUnique({
      where: {
        id: dto.employeeUserId,
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const updatedEmployee = await this.prisma.user.update({
      where: {
        id: employee.id,
      },
      data: {
        cardOtpLocked: false,
        cardOtpFailedCount: 0,
      },
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        department: true,
        cardOtpLocked: true,
        cardOtpFailedCount: true,
      },
    });

    await this.createAuditLog({
      actorUserId: admin.id,
      action: 'CARD_OTP_LOCK_CLEARED',
      entityType: 'User',
      entityId: employee.id,
      metadata: {
        kioskId: kiosk.id,
      },
    });

    return {
      success: true,
      employee: updatedEmployee,
    };
  }

  /**
   * Employee list for the kiosk Admin Help picker.
   * Protected by the verified admin card + kiosk device key (no JWT).
   * Returns only minimal, non-sensitive fields.
   */
  async adminListUsers(dto: AdminVerifyCardDto) {
    const { admin, kiosk } = await this.verifyAdminCard(
      dto.adminCardUid,
      dto.kioskDeviceKey,
    );

    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        fullName: 'asc',
      },
      select: {
        id: true,
        fullName: true,
        employeeCode: true,
        department: true,
        cardOtpLocked: true,
      },
    });

    await this.createAuditLog({
      actorUserId: admin.id,
      action: 'ADMIN_LISTED_USERS',
      entityType: 'Kiosk',
      entityId: kiosk.id,
      metadata: {
        kioskId: kiosk.id,
        count: users.length,
      },
    });

    return {
      success: true,
      users,
    };
  }
}
