export interface SmsProvider {
  sendOtp(phone: string, otp: string): Promise<void>;
}

export const SMS_PROVIDER = 'SMS_PROVIDER';
