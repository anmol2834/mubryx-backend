import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpProvider } from './otp.provider.interface';
import {
  SmsConfigurationError,
  SmsProviderError,
  SmsRejectedError,
  SmsTimeoutError,
  SmsUnavailableError
} from './errors';

@Injectable()
export class TwoFactorOtpProvider implements OtpProvider {
  private readonly logger = new Logger(TwoFactorOtpProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string = 'https://2factor.in/API/R1/';

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('TWOFACTOR_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.error('TWOFACTOR_API_KEY is not defined in the environment variables.');
    }
  }

  async sendOtp(phone: string, otp: string, template?: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.error('Cannot send OTP. TWOFACTOR_API_KEY is missing.');
      throw new SmsConfigurationError('SMS Provider configuration error: API Key missing');
    }

    if (!template) {
      this.logger.error('Template is required for 2Factor OTP provider.');
      throw new SmsConfigurationError('SMS Provider configuration error: Template missing');
    }

    let msgText = '';
    if (template === 'Customer Login') {
      msgText = `Dear Customer, ${otp} is your Mubryx Login verification code. Do not share OTP with anyone for account safety. Team Mubryx.`;
    } else if (template === 'Engineer Login') {
      msgText = `Dear Engineer, ${otp} is your Mubryx Account Login OTP. Team Mubryx.`;
    } else {
      // Fallback
      msgText = `Dear Customer, ${otp} is your Mubryx Login verification code. Do not share OTP with anyone for account safety. Team Mubryx.`;
    }

    // TwoFactor endpoint for sending Transactional SMS
    const encodedMsg = encodeURIComponent(msgText);
    
    // Read PEID and CTID from environment if they are configured
    const peid = this.config.get<string>('TWOFACTOR_PEID') || '';
    let ctid = '';
    if (template === 'Customer Login') {
      ctid = this.config.get<string>('TWOFACTOR_CTID_CUSTOMER') || '';
    } else if (template === 'Engineer Login') {
      ctid = this.config.get<string>('TWOFACTOR_CTID_ENGINEER') || '';
    }

    // Construct the URL with optional peid and ctid according to 2factor documentation
    let url = `${this.baseUrl}?module=TRANS_SMS&apikey=${this.apiKey}&to=${phone}&from=MUBRYX&msg=${encodedMsg}`;
    if (peid && ctid) {
      url += `&peid=${peid}&ctid=${ctid}`;
    }

    let response: Response;

    try {
      // Create a timeout controller to explicitly handle timeouts
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      try {
        response = await fetch(url, { method: 'GET', signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      if (errMessage.includes('abort') || errMessage.includes('timeout')) {
        this.logger.error(`2Factor API Timeout: ${errMessage}`);
        throw new SmsTimeoutError('Provider timeout while sending SMS');
      }
      this.logger.error(`Network error while sending 2Factor OTP: ${errMessage}`);
      throw new SmsUnavailableError(`Network error communicating with provider: ${errMessage}`);
    }

    let data: any;
    try {
      data = await response.json();
    } catch (e) {
      this.logger.error(`Malformed JSON response from 2Factor API. Status: ${response.status}`);
      throw new SmsProviderError('Malformed response from SMS provider');
    }

    // Validate expected fields
    if (!data || typeof data.Status !== 'string') {
      this.logger.error(`Invalid response structure from 2Factor API. Body: ${JSON.stringify(data)}`);
      throw new SmsProviderError('Unexpected response structure from SMS provider');
    }

    if (!response.ok || data.Status === 'Error') {
      this.logger.error(`2Factor API Error: ${response.status} ${response.statusText}`, data);
      
      const errorDetails = data.Details || '';
      
      if (errorDetails.includes('Invalid Phone Number') || errorDetails.includes('Length Mismatch')) {
        throw new SmsRejectedError(`Provider rejected the phone number: ${errorDetails}`);
      }
      
      if (errorDetails.includes('Invalid API Key')) {
        throw new SmsConfigurationError(`Provider configuration rejected: ${errorDetails}`);
      }

      throw new SmsProviderError(`Provider rejected request: ${errorDetails}`);
    }

    if (data.Status === 'Success' && data.Details) {
      this.logger.log(`Successfully sent OTP via 2Factor for template: ${template}. Session ID: ${data.Details}`);
    } else {
      this.logger.warn(`2Factor API returned unknown success structure: ${JSON.stringify(data)}`);
      throw new SmsProviderError('Provider returned an unknown success state');
    }
  }
}
