jest.mock('expo-server-sdk', () => {
  class MockExpo {
    static isExpoPushToken(token: string) {
      return typeof token === 'string' && token.startsWith('ExponentPushToken[');
    }
    chunkPushNotifications(messages: any[]) {
      return [messages];
    }
    async sendPushNotificationsAsync(messages: any[]) {
      return [];
    }
  }
  return {
    Expo: MockExpo,
  };
});

import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebaseAdminService } from '../../infrastructure/firebase/firebase-admin.service';

describe('NotificationsService (Enterprise FCM)', () => {
  let service: NotificationsService;
  let prisma: any;
  let firebaseAdmin: any;

  const mockPrismaService = {
    devicePushToken: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockFirebaseAdminService = {
    isReady: jest.fn().mockReturnValue(true),
    sendToDevice: jest.fn(),
    sendToMultipleDevices: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FirebaseAdminService, useValue: mockFirebaseAdminService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    prisma = module.get<PrismaService>(PrismaService);
    firebaseAdmin = module.get<FirebaseAdminService>(FirebaseAdminService);
    jest.clearAllMocks();
  });

  describe('registerDevice', () => {
    it('should reject invalid or too short push token', async () => {
      const result = await service.registerDevice('user-1', {
        pushToken: 'short',
      } as any);

      expect(result.success).toBe(false);
      expect(prisma.devicePushToken.findUnique).not.toHaveBeenCalled();
    });

    it('should create new DevicePushToken when token does not exist', async () => {
      prisma.devicePushToken.findUnique.mockResolvedValue(null);
      prisma.devicePushToken.create.mockResolvedValue({ id: 'tok-1' });

      const result = await service.registerDevice('user-1', {
        pushToken: 'dK3-9_vQ7R8:APA91bFValidToken123456789',
        platform: 'android',
        deviceId: 'pixel-8',
        appVersion: '1.0.0',
      });

      expect(result.success).toBe(true);
      expect(prisma.devicePushToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          pushToken: 'dK3-9_vQ7R8:APA91bFValidToken123456789',
          platform: 'android',
          deviceId: 'pixel-8',
          appVersion: '1.0.0',
          isActive: true,
        }),
      });
    });

    it('should idempotently update existing token and reassign userId if changed', async () => {
      prisma.devicePushToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: 'previous-user',
        pushToken: 'dK3-9_vQ7R8:APA91bFValidToken123456789',
        deviceId: 'pixel-8',
        platform: 'android',
      });
      prisma.devicePushToken.update.mockResolvedValue({ id: 'tok-1' });

      const result = await service.registerDevice('new-user-2', {
        pushToken: 'dK3-9_vQ7R8:APA91bFValidToken123456789',
        platform: 'android',
        deviceId: 'pixel-8',
        appVersion: '1.0.1',
      });

      expect(result.success).toBe(true);
      expect(prisma.devicePushToken.update).toHaveBeenCalledWith({
        where: { pushToken: 'dK3-9_vQ7R8:APA91bFValidToken123456789' },
        data: expect.objectContaining({
          userId: 'new-user-2',
          isActive: true,
          appVersion: '1.0.1',
        }),
      });
    });
  });

  describe('deactivateDevice', () => {
    it('should deactivate token on logout by pushToken', async () => {
      prisma.devicePushToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.deactivateDevice('user-1', {
        pushToken: 'dK3-9_vQ7R8:APA91bFValidToken123456789',
      });

      expect(result.success).toBe(true);
      expect(prisma.devicePushToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          pushToken: 'dK3-9_vQ7R8:APA91bFValidToken123456789',
        },
        data: expect.objectContaining({ isActive: false }),
      });
    });
  });

  describe('sendTestNotification', () => {
    it('should return error when technician has no registered active tokens', async () => {
      prisma.devicePushToken.findMany.mockResolvedValue([]);

      const result = await service.sendTestNotification('tech-user-empty');

      expect(result.success).toBe(false);
      expect(result.message).toContain('No active device push tokens found');
      expect(firebaseAdmin.sendToMultipleDevices).not.toHaveBeenCalled();
    });

    it('should dispatch test push to registered native FCM tokens', async () => {
      prisma.devicePushToken.findMany.mockResolvedValue([
        { pushToken: 'fcm-token-test-1234567890', platform: 'android', isActive: true },
      ]);

      firebaseAdmin.sendToMultipleDevices.mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        invalidTokens: [],
      });

      const result = await service.sendTestNotification('tech-user-1', {
        title: 'Custom Test Title',
        body: 'Custom body test message',
      });

      expect(result.success).toBe(true);
      expect(firebaseAdmin.sendToMultipleDevices).toHaveBeenCalledWith(
        ['fcm-token-test-1234567890'],
        expect.objectContaining({
          title: 'Custom Test Title',
          body: 'Custom body test message',
          channelId: 'booking_requests',
          priority: 'high',
        }),
      );
    });
  });

  describe('sendBookingRequest via FCM', () => {
    it('should dispatch to native FCM tokens and deactivate reported invalid tokens', async () => {
      prisma.devicePushToken.findMany.mockResolvedValue([
        { pushToken: 'fcm-valid-token-1234567890', platform: 'android', isActive: true },
        { pushToken: 'fcm-dead-token-1234567890', platform: 'android', isActive: true },
      ]);

      firebaseAdmin.sendToMultipleDevices.mockResolvedValue({
        successCount: 1,
        failureCount: 1,
        invalidTokens: ['fcm-dead-token-1234567890'],
      });

      await service.sendBookingRequest('tech-user-1', {
        bookingId: 'book-123',
        serviceSummary: 'AC Repair',
        totalAmount: 1500,
        distanceKm: 3.5,
      });

      expect(firebaseAdmin.sendToMultipleDevices).toHaveBeenCalledWith(
        ['fcm-valid-token-1234567890', 'fcm-dead-token-1234567890'],
        expect.objectContaining({
          title: '🚨 NEW SERVICE REQUEST',
          channelId: 'booking_requests',
          priority: 'high',
        }),
      );

      expect(prisma.devicePushToken.updateMany).toHaveBeenCalledWith({
        where: { pushToken: { in: ['fcm-dead-token-1234567890'] } },
        data: { isActive: false },
      });
    });
  });
});
