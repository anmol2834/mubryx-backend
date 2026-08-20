import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpProvider } from './otp.provider.interface';
import {
  SmsConfigurationError,
  SmsProviderError,
  SmsTimeoutError,
  SmsUnavailableError
} from './errors';

@Injectable()
export class Msg91OtpProvider implements OtpProvider {
  private readonly logger = new Logger(Msg91OtpProvider.name);
  private readonly authKey: string;
  private readonly templateId: string;
  private readonly baseUrl: string = 'https://control.msg91.com/api/v5/otp';

  constructor(private readonly config: ConfigService) {
    this.authKey = this.config.get<string>('MSG91_AUTH_KEY') || '';
    this.templateId = this.config.get<string>('MSG91_TEMPLATE_ID') || '';
    
    if (!this.authKey) {
      this.logger.error('MSG91_AUTH_KEY is not defined in the environment variables.');
    }
  }

  async sendOtp(phone: string, otp: string, template?: string): Promise<void> {
    if (!this.authKey) {
      throw new SmsConfigurationError('SMS Provider configuration error: MSG91 Auth Key missing');
    }

    // You can also use the dynamic template if provided, else fallback to MSG91_TEMPLATE_ID
    const finalTemplate = this.templateId;

    const url = `${this.baseUrl}?template_id=${finalTemplate}&mobile=91${phone}&authkey=${this.authKey}&otp=${otp}`;

    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        response = await fetch(url, { method: 'GET', signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      if (errMessage.includes('abort') || errMessage.includes('timeout')) {
        throw new SmsTimeoutError('Provider timeout while sending SMS');
      }
      throw new SmsUnavailableError(`Network error communicating with MSG91: ${errMessage}`);
    }

    let data: any;
    try {
      data = await response.json();
    } catch (e) {
      throw new SmsProviderError('Malformed response from MSG91');
    }

    if (data.type === 'error') {
      this.logger.error(`MSG91 Error: ${data.message}`, data);
      throw new SmsProviderError(`Provider rejected request: ${data.message}`);
    }

    if (data.type === 'success') {
      this.logger.log(`Successfully sent OTP via MSG91 for phone: ${phone}`);
    } else {
      throw new SmsProviderError('MSG91 returned an unknown success state');
    }
  }
}
