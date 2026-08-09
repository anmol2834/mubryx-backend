import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpProvider } from './otp.provider.interface';

@Injectable()
export class DevelopmentOtpProvider implements OtpProvider {
  private readonly logger = new Logger(DevelopmentOtpProvider.name);

  constructor(private readonly config: ConfigService) {}

  async sendOtp(phone: string, otp: string): Promise<void> {
    const fixedOtp = this.config.get<string>('CUSTOMER_DEV_OTP', '000000');
    
    // Warn if the generated OTP differs from the fixed dev OTP (though OtpService should handle this)
    if (otp !== fixedOtp) {
      this.logger.warn(`Dev mode: Overriding generated OTP ${otp} with fixed OTP ${fixedOtp}`);
    }

    this.logger.log(`[DEV MODE] Sending OTP ${fixedOtp} to +91${phone}`);
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
