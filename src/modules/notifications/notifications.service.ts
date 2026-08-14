import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebaseAdminService } from '../../infrastructure/firebase/firebase-admin.service';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { DeactivateDeviceDto } from './dto/deactivate-device.dto';
import { TestNotificationDto } from './dto/test-notification.dto';

@Injectable()
export class NotificationsService {
  private expo: Expo;
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseAdmin: FirebaseAdminService,
  ) {
    this.expo = new Expo({ accessToken: process.env['EXPO_ACCESS_TOKEN'] });
  }

  /**
   * Registers or updates a device push token for an authenticated user.
   * Fully idempotent: updates existing records or reassigns ownership cleanly.
   */
  async registerDevice(userId: string, data: RegisterDeviceDto) {
    if (!data?.pushToken || typeof data.pushToken !== 'string' || data.pushToken.trim().length < 10) {
      this.logger.warn(`Invalid device push token received from user ${userId}: ${data?.pushToken}`);
      return { success: false, message: 'Invalid token format' };
    }

    const pushToken = data.pushToken.trim();

    try {
      const existingToken = await this.prisma.devicePushToken.findUnique({
        where: { pushToken },
      });

      if (existingToken) {
        // Skip redundant database updates if token is already active for this user within the last 5 minutes
        const isRecent = existingToken.updatedAt && (Date.now() - existingToken.updatedAt.getTime() < 300000);
        if (existingToken.userId === userId && existingToken.isActive && isRecent) {
          return { success: true, message: 'Device token already registered and active' };
        }

        await this.prisma.devicePushToken.update({
          where: { pushToken },
          data: {
            userId,
            deviceId: data.deviceId || existingToken.deviceId,
            platform: data.platform || existingToken.platform,
            appVersion: data.appVersion || existingToken.appVersion,
            isActive: true,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          },
        });
        this.logger.log(`[NotificationsService] Reactivated/updated push token for user ${userId}`);
      } else {
        await this.prisma.devicePushToken.create({
          data: {
            userId,
            pushToken,
            deviceId: data.deviceId,
            platform: data.platform || 'android',
            appVersion: data.appVersion,
            isActive: true,
            lastSeenAt: new Date(),
          },
        });
        this.logger.log(`[NotificationsService] Created new device push token for user ${userId}`);
      }

      return { success: true, message: 'Device registered successfully' };
    } catch (err: any) {
      this.logger.error(
        `[NotificationsService] Error registering device token for user ${userId}: ${err?.message}`,
        err?.stack,
      );
      return { success: false, message: 'Failed to persist device token' };
    }
  }

  /**
   * Deactivates a device token upon logout.
   */
  async deactivateDevice(userId: string, data: DeactivateDeviceDto) {
    try {
      if (data?.pushToken) {
        await this.prisma.devicePushToken.updateMany({
          where: {
            userId,
            pushToken: data.pushToken.trim(),
          },
          data: {
            isActive: false,
            updatedAt: new Date(),
          },
        });
        this.logger.log(`[NotificationsService] Deactivated push token for user ${userId}`);
      } else if (data?.deviceId) {
        await this.prisma.devicePushToken.updateMany({
          where: {
            userId,
            deviceId: data.deviceId,
          },
          data: {
            isActive: false,
            updatedAt: new Date(),
          },
        });
        this.logger.log(
          `[NotificationsService] Deactivated devices with deviceId=${data.deviceId} for user ${userId}`,
        );
      }

      return { success: true, message: 'Device deactivated successfully' };
    } catch (err: any) {
      this.logger.error(`[NotificationsService] Error deactivating device for user ${userId}:`, err?.message);
      return { success: false, message: 'Failed to deactivate device' };
    }
  }

  /**
   * Sends an isolated test notification to an authenticated technician's registered devices.
   * Completely independent of booking flow and Socket.IO events.
   */
  async sendTestNotification(userId: string, dto?: TestNotificationDto) {
    const title = dto?.title?.trim() || 'Mubryx Test';
    const body = dto?.body?.trim() || 'FCM push notification is working.';
    const customData = {
      type: 'test',
      sentAt: new Date().toISOString(),
      ...(dto?.data || {}),
    };

    try {
      const tokens = await this.prisma.devicePushToken.findMany({
        where: { userId, isActive: true },
      });

      if (!tokens.length) {
        this.logger.warn(`[NotificationsService] No active device tokens found for user ${userId}`);
        return {
          success: false,
          message: 'No active device push tokens found for this account. Please open the app and grant notification permissions.',
          tokensCount: 0,
          isMockMode: !this.firebaseAdmin.isReady(),
        };
      }

      const nativeFcmTokens: string[] = [];
      const expoTokens: string[] = [];

      for (const tokenRecord of tokens) {
        if (Expo.isExpoPushToken(tokenRecord.pushToken)) {
          expoTokens.push(tokenRecord.pushToken);
        } else {
          nativeFcmTokens.push(tokenRecord.pushToken);
        }
      }

      let fcmSuccessCount = 0;
      let fcmFailureCount = 0;

      // 1. Dispatch to native FCM tokens
      if (nativeFcmTokens.length > 0) {
        const result = await this.firebaseAdmin.sendToMultipleDevices(nativeFcmTokens, {
          title,
          body,
          data: customData,
          channelId: 'booking_requests',
          priority: 'high',
        });

        fcmSuccessCount = result.successCount;
        fcmFailureCount = result.failureCount;

        if (result.invalidTokens && result.invalidTokens.length > 0) {
          await this.prisma.devicePushToken.updateMany({
            where: { pushToken: { in: result.invalidTokens } },
            data: { isActive: false },
          });
        }
      }

      // 2. Dispatch to Expo tokens (if testing in Expo Go)
      let expoSuccessCount = 0;
      if (expoTokens.length > 0) {
        const messages: ExpoPushMessage[] = expoTokens.map((to) => ({
          to,
          sound: 'default',
          title,
          body,
          data: customData,
          channelId: 'booking_requests',
          priority: 'high',
        }));

        const chunks = this.expo.chunkPushNotifications(messages);
        const tickets = [];

        for (const chunk of chunks) {
          try {
            const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
            tickets.push(...ticketChunk);
            expoSuccessCount += ticketChunk.filter((t) => t.status === 'ok').length;
          } catch (error) {
            this.logger.error(`Error sending Expo test push chunk:`, error);
          }
        }

        this.processTickets(tickets, tokens);
      }

      const isMockMode = !this.firebaseAdmin.isReady();

      this.logger.log(
        `[NotificationsService] Test notification dispatched for user ${userId} (FCM: ${fcmSuccessCount}/${nativeFcmTokens.length}, Expo: ${expoSuccessCount}/${expoTokens.length}, Mock: ${isMockMode})`,
      );

      return {
        success: true,
        message: isMockMode
          ? 'Test notification processed in mock mode (Firebase credentials not configured).'
          : 'Test push notification dispatched successfully.',
        details: {
          recipientUserId: userId,
          title,
          body,
          nativeFcmTokensCount: nativeFcmTokens.length,
          fcmSuccessCount,
          fcmFailureCount,
          expoTokensCount: expoTokens.length,
          expoSuccessCount,
          isMockMode,
        },
      };
    } catch (err: any) {
      this.logger.error(`[NotificationsService] Error sending test notification:`, err?.message);
      return {
        success: false,
        message: 'Failed to send test push notification',
        error: err?.message,
      };
    }
  }

  /**
   * Dispatches time-critical booking request push notifications to a technician.
   * Emits to native FCM tokens via Firebase Admin and Expo push tokens via Expo SDK.
   * FCM failures are non-fatal to ensure booking transactions remain intact.
   */
  async sendBookingRequest(technicianUserId: string, payload: any) {
    try {
      const tokens = await this.prisma.devicePushToken.findMany({
        where: { userId: technicianUserId, isActive: true },
      });

      if (!tokens.length) {
        this.logger.debug(`No active push tokens found for user ${technicianUserId}`);
        return;
      }

      const distanceText = payload.distanceKm ? `${payload.distanceKm} km away` : 'Nearby';
      const cityText = payload.customerArea || payload.serviceLocation?.city || 'Nearby';
      const amountText = payload.totalAmount ? `₹${payload.totalAmount}` : 'New Request';
      const serviceTitle = payload.serviceSummary || payload.categoryName || 'Service Request';
      const title = '🚨 NEW SERVICE REQUEST';
      const body = `${serviceTitle} • ${distanceText} • ${cityText} • ${amountText}`;
      const fcmData = {
        type: 'NEW_BOOKING',
        bookingId: String(payload.bookingId || ''),
        bookingNumber: String(payload.bookingNumber || ''),
        bookingItemId: String(payload.bookingItemId || ''),
        serviceTitle: String(serviceTitle),
        distance: String(distanceText),
        city: String(cityText),
        amount: String(payload.totalAmount || ''),
        expiresAt: String(payload.expiresAt || ''),
        ...payload,
      };

      const nativeFcmTokens: string[] = [];
      const expoTokens: string[] = [];

      for (const tokenRecord of tokens) {
        if (Expo.isExpoPushToken(tokenRecord.pushToken)) {
          expoTokens.push(tokenRecord.pushToken);
        } else {
          nativeFcmTokens.push(tokenRecord.pushToken);
        }
      }

      // 1. Native Android FCM Dispatch
      if (nativeFcmTokens.length > 0) {
        const result = await this.firebaseAdmin.sendToMultipleDevices(nativeFcmTokens, {
          title,
          body,
          data: fcmData,
          channelId: 'booking_requests',
          priority: 'high',
        });

        this.logger.log(
          `[NotificationsService] FCM dispatch for user ${technicianUserId}: ${result.successCount} succeeded, ${result.failureCount} failed`,
        );

        // Deactivate dead / unregistered tokens reported by Firebase
        if (result.invalidTokens && result.invalidTokens.length > 0) {
          await this.prisma.devicePushToken.updateMany({
            where: { pushToken: { in: result.invalidTokens } },
            data: { isActive: false },
          });
          this.logger.log(
            `[NotificationsService] Deactivated ${result.invalidTokens.length} dead FCM tokens for user ${technicianUserId}`,
          );
        }
      }

      // 2. Expo Push Dispatch (if any legacy Expo tokens exist)
      if (expoTokens.length > 0) {
        const messages: ExpoPushMessage[] = expoTokens.map((to) => ({
          to,
          sound: 'default',
          title,
          body,
          data: fcmData,
          channelId: 'booking_requests',
          priority: 'high',
          ttl: 60,
          categoryId: 'booking_requests',
        } as any));

        const chunks = this.expo.chunkPushNotifications(messages);
        const tickets = [];

        for (const chunk of chunks) {
          try {
            const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
            tickets.push(...ticketChunk);
          } catch (error) {
            this.logger.error(`Error sending Expo push chunk to user ${technicianUserId}:`, error);
          }
        }

        this.processTickets(tickets, tokens);
      }
    } catch (error: any) {
      // Non-fatal catch to ensure business logic is never broken by push delivery issues
      this.logger.error(`[NotificationsService] Non-fatal error sending booking request push:`, error?.message);
    }
  }

  /**
   * Dispatches lifecycle booking updates (assignment changes, cancellation, customer notes).
   */
  async sendBookingUpdate(technicianUserId: string, title: string, body: string, payload: any) {
    try {
      const tokens = await this.prisma.devicePushToken.findMany({
        where: { userId: technicianUserId, isActive: true },
      });

      if (!tokens.length) return;

      const nativeFcmTokens: string[] = [];
      const expoTokens: string[] = [];

      for (const tokenRecord of tokens) {
        if (Expo.isExpoPushToken(tokenRecord.pushToken)) {
          expoTokens.push(tokenRecord.pushToken);
        } else {
          nativeFcmTokens.push(tokenRecord.pushToken);
        }
      }

      // 1. Native Android FCM Dispatch
      if (nativeFcmTokens.length > 0) {
        const result = await this.firebaseAdmin.sendToMultipleDevices(nativeFcmTokens, {
          title,
          body,
          data: payload,
          channelId: 'booking_updates',
          priority: 'high',
        });

        if (result.invalidTokens && result.invalidTokens.length > 0) {
          await this.prisma.devicePushToken.updateMany({
            where: { pushToken: { in: result.invalidTokens } },
            data: { isActive: false },
          });
        }
      }

      // 2. Expo Push Dispatch
      if (expoTokens.length > 0) {
        const messages: ExpoPushMessage[] = expoTokens.map((to) => ({
          to,
          sound: 'default',
          title,
          body,
          data: payload,
          channelId: 'booking_updates',
          priority: 'high',
        }));

        const chunks = this.expo.chunkPushNotifications(messages);
        const tickets = [];

        for (const chunk of chunks) {
          try {
            const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
            tickets.push(...ticketChunk);
          } catch (error) {
            this.logger.error(`Error sending Expo push update chunk:`, error);
          }
        }

        this.processTickets(tickets, tokens);
      }
    } catch (error: any) {
      this.logger.error(`[NotificationsService] Non-fatal error sending booking update push:`, error?.message);
    }
  }

  private async processTickets(tickets: any[], tokens: any[]) {
    tickets.forEach(async (ticket, index) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        const token = tokens[index];
        if (token) {
          this.logger.log(`Marking token ${token.pushToken} as inactive due to DeviceNotRegistered.`);
          await this.prisma.devicePushToken.update({
            where: { pushToken: token.pushToken },
            data: { isActive: false },
          });
        }
      }
    });
  }
}
