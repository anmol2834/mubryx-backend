import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { OtpService } from './services/otp.service';
import { TokenService } from './services/token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeIndianPhoneNumber } from '../../common/utils/phone.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async sendOtp(phone: string) {
    const normalizedPhone = normalizeIndianPhoneNumber(phone);
    if (!normalizedPhone) {
      throw new BadRequestException('Invalid Indian mobile number');
    }

    const result = await this.otpService.requestOtp(normalizedPhone);
    return {
      message: 'OTP sent successfully',
      phone: normalizedPhone,
      devOtp: result.devOtp,
    };
  }

  async verifyOtp(phone: string, code: string, fullName?: string, deviceInfo?: string) {
    const normalizedPhone = normalizeIndianPhoneNumber(phone);
    if (!normalizedPhone) {
      throw new BadRequestException('Invalid Indian mobile number');
    }

    // This will throw if invalid or too many attempts
    await this.otpService.verifyOtp(normalizedPhone, code);

    // 1. Upsert User
    let isNewUser = false;
    let user = await this.prisma.user.findUnique({
      where: { phone: normalizedPhone },
    });

    if (!user) {
      isNewUser = true;
      user = await this.prisma.user.create({
        data: {
          phone: normalizedPhone,
          name: fullName || null,
          role: 'CUSTOMER',
        },
      });
      // Optionally create CustomerProfile here, but typically we can create it inside completeRegistration or here.
      await this.prisma.customerProfile.create({
        data: { userId: user.id },
      });
    }

    // If user's name is missing or empty, they are considered "new" for profile completion purposes
    const needsProfileCompletion = !user.name || user.name.trim() === '';

    // 2. Generate Tokens
    const tokens = await this.tokenService.generateTokens(user, deviceInfo);

    return {
      user: {
        id: user.id,
        fullName: user.name,
        phone: user.phone,
        role: user.role,
        isPhoneVerified: true,
      },
      ...tokens,
      isNewUser: needsProfileCompletion,
    };
  }

  async refreshTokens(refreshToken: string, deviceInfo?: string) {
    if (!refreshToken) throw new UnauthorizedException('Refresh token is required');
    return this.tokenService.rotateTokens(refreshToken, deviceInfo);
  }

  async logout(refreshToken: string) {
    if (refreshToken) {
      await this.tokenService.revokeToken(refreshToken);
    }
    return { message: 'Logged out successfully' };
  }
}
