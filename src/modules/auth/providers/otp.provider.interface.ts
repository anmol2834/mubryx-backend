export const OTP_PROVIDER = 'OTP_PROVIDER';

export interface OtpProvider {
  /**
   * Sends an OTP to the given phone number.
   * @param phone Normalized 10-digit phone number.
   * @param otp The 6-digit OTP code to send.
   */
  sendOtp(phone: string, otp: string): Promise<void>;
}
