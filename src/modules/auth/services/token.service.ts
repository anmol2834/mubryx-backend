import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { User, UserRole } from '../../../generated/prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class TokenService {
  private readonly refreshExpiresSec: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.refreshExpiresSec = 7 * 24 * 60 * 60; // 7 days fallback
  }

  /**
   * Generates new access and refresh tokens, storing the session in PostgreSQL.
   */
  async generateTokens(user: User, deviceInfo?: string): Promise<{ accessToken: string; refreshToken: string }> {
    // 1. Generate access token
    const accessToken = this.jwtService.sign({
      sub: user.id,
      role: user.role,
    });

    // 2. Generate secure random string for refresh token
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    // 3. Calculate expiry dates
    const jwtExp = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
    const refreshExpiresAt = new Date();
    refreshExpiresAt.setDate(refreshExpiresAt.getDate() + 7); // Handle simple 7d

    // 4. Create Session and RefreshToken records transactionally
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.create({
        data: {
          userId: user.id,
          deviceInfo,
          expiresAt: refreshExpiresAt,
        },
      });

      await tx.refreshToken.create({
        data: {
          sessionId: session.id,
          userId: user.id,
          tokenHash,
          expiresAt: refreshExpiresAt,
        },
      });
    });

    return { accessToken, refreshToken };
  }

  async rotateTokens(oldRefreshToken: string, deviceInfo?: string): Promise<{ accessToken: string; refreshToken: string }> {
    if (typeof oldRefreshToken !== 'string') {
      throw new UnauthorizedException('Invalid token format');
    }

    const tokenHash = crypto.createHash('sha256').update(oldRefreshToken).digest('hex');

    // Find valid refresh token
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { session: true, user: true },
    });

    if (!tokenRecord || tokenRecord.isRevoked || tokenRecord.expiresAt < new Date() || !tokenRecord.session || !tokenRecord.session.isActive) {
      if (tokenRecord && !tokenRecord.isRevoked) {
        // If someone uses an expired but unrevoked token, revoke it
        await this.revokeToken(oldRefreshToken);
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Revoke the old token (one-time use)
    await this.revokeToken(oldRefreshToken);

    // Ensure user is still active
    if (!tokenRecord.user.isActive) {
      throw new UnauthorizedException('User account is inactive');
    }

    // Issue new pair
    return this.generateTokens(tokenRecord.user, deviceInfo);
  }

  /**
   * Revokes a refresh token (and invalidates its session).
   */
  async revokeToken(refreshToken: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (tokenRecord) {
      await this.prisma.$transaction([
        this.prisma.refreshToken.update({
          where: { id: tokenRecord.id },
          data: { isRevoked: true },
        }),
        this.prisma.session.update({
          where: { id: tokenRecord.sessionId },
          data: { isActive: false },
        }),
      ]);
    }
  }

  /**
   * Logs out from current session.
   * In a real app, you might extract the token from the request header directly.
   */
  async revokeSessionForUser(userId: string): Promise<void> {
    // Basic implementation: Revoke all sessions for a user (or you could target a specific sessionId)
    // For now, to keep it simple, we will just rely on revoking specific token/session in logout flow.
    await this.prisma.session.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });
  }
}
