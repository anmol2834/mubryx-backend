import { Controller, Post, Body, Headers, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('send-otp')
  async sendOtp(@Body() body: { phone: string }) {
    if (!body.phone) {
      throw new UnauthorizedException('Phone number is required');
    }
    return this.authService.sendOtp(body.phone);
  }

  @Post('verify-otp')
  async verifyOtp(
    @Body() body: { phone: string; code: string; fullName?: string },
    @Headers('user-agent') userAgent: string,
  ) {
    if (!body.phone || !body.code) {
      throw new UnauthorizedException('Phone and code are required');
    }
    return this.authService.verifyOtp(body.phone, body.code, body.fullName, userAgent);
  }

  @Post('refresh')
  async refresh(
    @Body() body: { token?: string } | undefined,
    @Headers('authorization') authHeader: string,
    @Headers('user-agent') userAgent: string,
  ) {
    let token = body?.token;
    if (!token && authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (!token) {
      throw new UnauthorizedException('Refresh token not provided');
    }
    
    return this.authService.refreshTokens(token, userAgent);
  }

  @Post('logout')
  async logout(
    @Headers('authorization') authHeader: string,
  ) {
    // Client sends accessToken as Bearer in Authorization header.
    // We simply return success — token invalidation via DB session
    // happens server-side when the refresh token is rotated/expired.
    // The client clears tokens locally on logout regardless.
    return { message: 'Logged out successfully' };
  }
}
