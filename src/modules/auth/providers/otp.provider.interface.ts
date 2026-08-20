export const OTP_PROVIDER = 'OTP_PROVIDER';

export interface OtpProvider {
  /**
   * Sends an OTP to the given phone number.
   * @param phone Normalized 10-digit phone number.
   * @param otp The 6-digit OTP code to send.
   * @param template Optional template name for providers that require it.
   */
  sendOtp(phone: string, otp: string, template?: string): Promise<void>;
}
