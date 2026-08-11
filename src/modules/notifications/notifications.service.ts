import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@prisma-service/prisma.service';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

@Injectable()
export class NotificationsService {
  private expo: Expo;
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {
    this.expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  }

  async registerDevice(userId: string, data: { pushToken: string; deviceId?: string; platform?: string }) {
    if (!Expo.isExpoPushToken(data.pushToken)) {
      this.logger.warn(`Invalid Expo push token received from user ${userId}: ${data.pushToken}`);
      // Returning success but not saving invalid tokens to prevent failures
      return { success: false, message: 'Invalid token format' };
    }

    const existingToken = await this.prisma.devicePushToken.findUnique({
      where: { pushToken: data.pushToken },
    });

    if (existingToken) {
      if (existingToken.userId !== userId) {
        // Re-assign to new user if token is identical
        await this.prisma.devicePushToken.update({
          where: { pushToken: data.pushToken },
          data: { userId, isActive: true, updatedAt: new Date() },
        });
      } else if (!existingToken.isActive) {
        await this.prisma.devicePushToken.update({
          where: { pushToken: data.pushToken },
          data: { isActive: true, updatedAt: new Date() },
        });
      }
    } else {
      await this.prisma.devicePushToken.create({
        data: {
          userId,
          pushToken: data.pushToken,
          deviceId: data.deviceId,
          platform: data.platform,
        },
      });
    }

    return { success: true };
  }

  async sendBookingRequest(technicianUserId: string, payload: any) {
    const tokens = await this.prisma.devicePushToken.findMany({
      where: { userId: technicianUserId, isActive: true },
    });

    if (!tokens.length) {
      this.logger.debug(`No active push tokens found for user ${technicianUserId}`);
      return;
    }

    const messages: ExpoPushMessage[] = [];
    
    // Convert numerical distance safely
    const distanceText = payload.distanceKm ? `${payload.distanceKm} km away` : 'Nearby';
    const amountText = payload.totalAmount ? `₹${payload.totalAmount}` : 'New Request';

    for (const tokenRecord of tokens) {
      messages.push({
        to: tokenRecord.pushToken,
        sound: 'default',
        title: 'New Service Request',
        body: `${payload.serviceSummary || 'Service'} • ${amountText} • ${distanceText}`,
        data: { type: 'booking:incoming', ...payload },
        channelId: 'booking_requests',
        priority: 'high',
      });
    }

    const chunks = this.expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        this.logger.error(`Error sending push chunk to user ${technicianUserId}:`, error);
      }
    }

    // Clean up unregistered tokens
    this.processTickets(tickets, tokens);
  }

  async sendBookingUpdate(technicianUserId: string, title: string, body: string, payload: any) {
    const tokens = await this.prisma.devicePushToken.findMany({
      where: { userId: technicianUserId, isActive: true },
    });

    if (!tokens.length) return;

    const messages: ExpoPushMessage[] = tokens.map((tokenRecord: any) => ({
      to: tokenRecord.pushToken,
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
        this.logger.error(`Error sending push update chunk:`, error);
      }
    }
    
    this.processTickets(tickets, tokens);
  }

  private async processTickets(tickets: any[], tokens: any[]) {
    // Determine which tokens failed with DeviceNotRegistered and mark them inactive
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


