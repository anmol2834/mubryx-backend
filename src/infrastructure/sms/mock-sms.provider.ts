import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms.provider';

@Injectable()
export class MockSmsProvider implements SmsProvider {
  private readonly logger = new Logger(MockSmsProvider.name);

  async sendOtp(phone: string, otp: string): Promise<void> {
    this.logger.log(`[MOCK SMS] OTP for ${phone}: ${otp}`);
  }
}
