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
export class ShreeSmsOtpProvider implements OtpProvider {
  private readonly logger = new Logger(ShreeSmsOtpProvider.name);
  private readonly apiKey: string;
  private readonly senderId: string;
  private readonly entityId: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('SHREESMS_API_KEY') || 'Sxc4Fe2Yn9Bkhw65tFhmWUByd8';
    this.senderId = this.config.get<string>('SHREESMS_SENDER_ID') || 'MUBRYX';
    this.entityId = this.config.get<string>('SHREESMS_ENTITY_ID') || '1701176910804995763';
    this.baseUrl = this.config.get<string>('SHREESMS_URL') || 'https://web.shreesms.net/API/SendSMS.aspx';
    
    if (!this.apiKey) {
      this.logger.error('SHREESMS_API_KEY is not defined in the environment variables.');
    }
  }

  async sendOtp(phone: string, otp: string, template?: string): Promise<void> {
    if (!this.apiKey) {
      throw new SmsConfigurationError('SMS Provider configuration error: ShreeSMS API Key missing');
    }

    const templateId = template || this.config.get<string>('SHREESMS_TEMPLATE_ID') || '';
    
    // Formatting MsgText properly - in many cases this is matched against DLT on the provider's end.
    const defaultText = `Dear Customer, ${otp} is your Mubryx website login verification code. Do not share otp with anyone for account safety. Team Mubryx.`;
    const msgTextStr = this.config.get<string>('SHREESMS_MSG_TEXT') || defaultText;
    const msgText = encodeURIComponent(msgTextStr.replace('{{otp}}', otp));

    const url = `${this.baseUrl}?APIkey=${this.apiKey}&SenderID=${this.senderId}&SMSType=2&Mobile=${phone}&MsgText=${msgText}&EntityID=${this.entityId}&TemplateID=${templateId}`;

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
        throw new SmsTimeoutError('Provider timeout while sending SMS via ShreeSMS');
      }
      throw new SmsUnavailableError(`Network error communicating with ShreeSMS: ${errMessage}`);
    }

    const responseText = await response.text();

    // Often SMS gateways return 'error' or 'failed' in plain text if it failed
    if (!response.ok || responseText.toLowerCase().includes('error')) {
      this.logger.error(`ShreeSMS Error: ${responseText}`);
      throw new SmsProviderError(`Provider rejected request: ${responseText}`);
    }

    this.logger.log(`Successfully sent OTP via ShreeSMS for phone: ${phone}`);
  }
}
