import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpService } from './otp.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { OTP_PROVIDER } from '../providers/otp.provider.interface';
import { TemplateResolver } from './template.resolver';
import * as crypto from 'crypto';

describe('OtpService', () => {
  let service: OtpService;
  let redisService: any;
  let otpProvider: any;
  let templateResolver: any;
  let configService: any;

  beforeEach(async () => {
    redisService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      ttl: jest.fn(),
      incr: jest.fn(),
      getClient: jest.fn().mockReturnValue({
        set: jest.fn(),
        expire: jest.fn(),
      }),
    };

    otpProvider = {
      sendOtp: jest.fn(),
    };

    templateResolver = {
      resolve: jest.fn().mockReturnValue('mock_template'),
    };

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'OTP_HASH_SECRET') return 'test_secret';
        if (key === 'NODE_ENV') return 'test';
        if (key === 'SMS_PROVIDER') return 'mock';
        if (key === 'CUSTOMER_OTP_MAX_ATTEMPTS') return 3;
        if (key === 'CUSTOMER_OTP_EXPIRES_SECONDS') return 300;
        if (key === 'CUSTOMER_OTP_RESEND_COOLDOWN_SECONDS') return 30;
        if (key === 'CUSTOMER_DEV_OTP') return '123456';
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: RedisService, useValue: redisService },
        { provide: ConfigService, useValue: configService },
        { provide: OTP_PROVIDER, useValue: otpProvider },
        { provide: TemplateResolver, useValue: templateResolver },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
  });

  describe('requestOtp', () => {
    it('should generate secure OTP, hash it, and prevent concurrent requests', async () => {
      // Mock lock acquisition success
      redisService.getClient().set.mockResolvedValue('OK');

      const result = await service.requestOtp('9999999999', 'CUSTOMER', 'LOGIN');

      expect(result.devOtp).toBe('123456');
      expect(redisService.getClient().set).toHaveBeenCalledWith(
        'otp:cooldown:customer:login:9999999999', '1', 'EX', 30, 'NX'
      );
      expect(otpProvider.sendOtp).toHaveBeenCalledWith('9999999999', '123456', 'mock_template');
      
      const expectedHash = crypto.createHmac('sha256', 'test_secret')
        .update('123456:9999999999:customer:login').digest('hex');
      
      expect(redisService.set).toHaveBeenCalledWith('otp:customer:login:9999999999', expectedHash, 300);
      expect(redisService.set).toHaveBeenCalledWith('otp:attempts:customer:login:9999999999', '0', 300);
    });

    it('should throw an exception if concurrent lock fails (already in cooldown)', async () => {
      redisService.getClient().set.mockResolvedValue(null);
      redisService.ttl.mockResolvedValue(15);

      await expect(service.requestOtp('9999999999', 'CUSTOMER', 'LOGIN'))
        .rejects.toThrow(HttpException);
    });
  });

  describe('verifyOtp', () => {
    it('should verify successfully with correctly hashed OTP', async () => {
      const correctHash = crypto.createHmac('sha256', 'test_secret')
        .update('123456:9999999999:customer:login').digest('hex');

      redisService.get.mockImplementation((key: string) => {
        if (key.includes('attempts')) return '0';
        return correctHash;
      });

      const result = await service.verifyOtp('9999999999', '123456', 'CUSTOMER', 'LOGIN');
      expect(result).toBe(true);
      expect(redisService.del).toHaveBeenCalled(); // Should clear OTP state
    });

    it('should throw BadRequestException for incorrect OTP and increment attempts', async () => {
      const correctHash = crypto.createHmac('sha256', 'test_secret')
        .update('123456:9999999999:customer:login').digest('hex');

      redisService.get.mockImplementation((key: string) => {
        if (key.includes('attempts')) return '0';
        return correctHash;
      });

      redisService.incr.mockResolvedValue(1);
      redisService.ttl.mockResolvedValue(290);

      await expect(service.verifyOtp('9999999999', '654321', 'CUSTOMER', 'LOGIN'))
        .rejects.toThrow(BadRequestException);
        
      expect(redisService.incr).toHaveBeenCalledWith('otp:attempts:customer:login:9999999999');
    });

    it('should delete OTP and throw HttpException when max attempts reached', async () => {
      redisService.get.mockImplementation((key: string) => {
        if (key.includes('attempts')) return '3'; // Max attempts is 3
        return 'some_hash';
      });

      await expect(service.verifyOtp('9999999999', '654321', 'CUSTOMER', 'LOGIN'))
        .rejects.toThrow(HttpException);

      expect(redisService.del).toHaveBeenCalledWith('otp:customer:login:9999999999');
    });
  });
});
