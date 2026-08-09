import { Injectable, Inject, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { OTP_PROVIDER, OtpProvider } from '../providers/otp.provider.interface';

@Injectable()
export class OtpService {
  private readonly otpExpiresSec: number;
  private readonly otpCooldownSec: number;
  private readonly otpMaxAttempts: number;
  private readonly devOtp: string;

  constructor(
    private readonly redisService: RedisService,
    private readonly config: ConfigService,
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,
  ) {
    this.otpExpiresSec = this.config.get<number>('CUSTOMER_OTP_EXPIRES_SECONDS', 300);
    this.otpCooldownSec = this.config.get<number>('CUSTOMER_OTP_RESEND_COOLDOWN_SECONDS', 30);
    this.otpMaxAttempts = this.config.get<number>('CUSTOMER_OTP_MAX_ATTEMPTS', 5);
    this.devOtp = this.config.get<string>('CUSTOMER_DEV_OTP', '000000');
  }

  private getOtpKey(phone: string) { return `customer:otp:${phone}`; }
  private getCooldownKey(phone: string) { return `customer:otp:cooldown:${phone}`; }
  private getAttemptsKey(phone: string) { return `customer:otp:attempts:${phone}`; }

  /**
   * Generates and sends an OTP, enforcing cooldown and deduplication.
   */
  async requestOtp(phone: string): Promise<{ expiresIn: number; resendAvailableIn: number; devOtp?: string }> {
    const cooldownKey = this.getCooldownKey(phone);
    const inCooldown = await this.redisService.get(cooldownKey);

    if (inCooldown) {
      const ttl = await this.redisService.ttl(cooldownKey);
      throw new HttpException(`Please wait ${ttl} seconds before requesting another OTP.`, HttpStatus.TOO_MANY_REQUESTS);
    }

    // Determine OTP value: Use dev OTP in development or fixed config.
    // Future: generate random 6-digit number if not in dev mode.
    const otpValue = this.devOtp; // Fixed for now per requirements

    // Reset attempts and save OTP
    const otpKey = this.getOtpKey(phone);
    const attemptsKey = this.getAttemptsKey(phone);
    
    await this.redisService.set(otpKey, otpValue, this.otpExpiresSec);
    await this.redisService.set(attemptsKey, '0', this.otpExpiresSec);
    
    // Set cooldown to prevent spam
    await this.redisService.set(cooldownKey, '1', this.otpCooldownSec);

    // Call provider
    await this.otpProvider.sendOtp(phone, otpValue);

    return {
      expiresIn: this.otpExpiresSec,
      resendAvailableIn: this.otpCooldownSec,
      devOtp: process.env.NODE_ENV !== 'production' ? otpValue : undefined,
    };
  }

  /**
   * Verifies the OTP, enforcing attempt limits.
   */
  async verifyOtp(phone: string, code: string): Promise<boolean> {
    const otpKey = this.getOtpKey(phone);
    const attemptsKey = this.getAttemptsKey(phone);

    const storedOtp = await this.redisService.get(otpKey);
    if (!storedOtp) {
      throw new BadRequestException('OTP expired or invalid');
    }

    const attemptsStr = await this.redisService.get(attemptsKey);
    let attempts = parseInt(attemptsStr || '0', 10);

    if (attempts >= this.otpMaxAttempts) {
      await this.redisService.del(otpKey);
      throw new HttpException('Too many invalid attempts. Please request a new OTP.', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (storedOtp !== code) {
      attempts += 1;
      await this.redisService.set(attemptsKey, attempts.toString(), this.otpExpiresSec);
      throw new BadRequestException(`Invalid OTP. You have ${this.otpMaxAttempts - attempts} attempts left.`);
    }

    // Success - clear OTP state
    await this.redisService.del(otpKey, attemptsKey, this.getCooldownKey(phone));
    
    return true;
  }
}
