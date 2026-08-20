import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TwoFactorOtpProvider } from './twofactor-otp.provider';
import { SmsConfigurationError, SmsProviderError, SmsRejectedError, SmsUnavailableError, SmsTimeoutError } from './errors';

describe('TwoFactorOtpProvider', () => {
  let provider: TwoFactorOtpProvider;
  let configService: any;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    configService = {
      get: jest.fn().mockReturnValue('test-api-key'),
    };

    fetchMock = jest.fn();
    global.fetch = fetchMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorOtpProvider,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    provider = module.get<TwoFactorOtpProvider>(TwoFactorOtpProvider);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should send OTP successfully', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ Status: 'Success', Details: 'session-uuid' }),
    });

    await expect(provider.sendOtp('9999999999', '123456', 'template1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://2factor.in/API/V1/test-api-key/SMS/9999999999/123456/template1',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('should throw SmsConfigurationError if API key is missing', async () => {
    configService.get.mockReturnValue(undefined);
    // Re-instantiate to trigger config check
    provider = new TwoFactorOtpProvider(configService);
    
    await expect(provider.sendOtp('9999999999', '123456', 'template1'))
      .rejects.toThrow(SmsConfigurationError);
  });

  it('should throw SmsConfigurationError if template is missing', async () => {
    await expect(provider.sendOtp('9999999999', '123456', ''))
      .rejects.toThrow(SmsConfigurationError);
  });

  it('should throw SmsRejectedError on invalid phone number', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: jest.fn().mockResolvedValue({ Status: 'Error', Details: 'Invalid Phone Number' }),
    });

    await expect(provider.sendOtp('999', '123456', 'template1'))
      .rejects.toThrow(SmsRejectedError);
  });

  it('should throw SmsProviderError on malformed JSON response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
    });

    await expect(provider.sendOtp('9999999999', '123456', 'template1'))
      .rejects.toThrow(SmsProviderError);
  });

  it('should throw SmsUnavailableError on network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(provider.sendOtp('9999999999', '123456', 'template1'))
      .rejects.toThrow(SmsUnavailableError);
  });

  it('should throw SmsTimeoutError on fetch timeout', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    await expect(provider.sendOtp('9999999999', '123456', 'template1'))
      .rejects.toThrow(SmsTimeoutError);
  });

  it('should throw SmsProviderError on malformed success response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ Status: 'Success' }), // Missing 'Details'
    });

    await expect(provider.sendOtp('9999999999', '123456', 'template1'))
      .rejects.toThrow(SmsProviderError);
  });
});
