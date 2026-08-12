import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { REALTIME_EVENTS } from '../../realtime/constants/realtime-events.constant';
import { OnboardingStatus } from '../../generated/prisma/client';

const TECHNICIAN_DISPATCH_RADIUS_KM = 30; // Configurable radius
const TECHNICIAN_LOCATION_MAX_AGE_SECONDS = 3600; // 1 hour freshness
const DISPATCH_EXPIRATION_SECONDS = 60; // 60 seconds to accept

function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
}

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async dispatchBooking(bookingId: string) {
    this.logger.log(`[DispatchService] Starting dispatch for booking=${bookingId}`);

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { items: { include: { service: true } } },
    });

    if (!booking) {
      this.logger.error(`[DispatchService] Booking ${bookingId} not found`);
      return;
    }

    if (booking.status !== 'TECHNICIAN_SEARCHING' && booking.status !== 'PENDING_MATCHING') {
      this.logger.log(`[DispatchService] Booking ${bookingId} is already in status ${booking.status}. Skipping dispatch.`);
      return;
    }

    if (!booking.serviceLatitude || !booking.serviceLongitude) {
      this.logger.error(`[DispatchService] Booking ${bookingId} lacks service coordinates`);
      return;
    }

    const categoryIds = Array.from(new Set(booking.items.map((item) => item.service?.categoryId).filter(Boolean))) as string[];

    // SAFETY GUARD: If no valid categoryIds could be resolved (e.g. orphaned service references),
    // abort dispatch entirely rather than broadcasting to ALL technicians without skill filtering.
    // This prevents wrong-category leads (e.g. Geyser → AC-only technician).
    if (categoryIds.length === 0) {
      this.logger.warn(`[DispatchService] Booking ${bookingId} has no resolvable categoryIds from items. Aborting dispatch to prevent unfiltered broadcast.`);
      return;
    }

    this.logger.log(`[DispatchService] Dispatching for categoryIds=[${categoryIds.join(', ')}] on booking=${bookingId}`);

    // Find all online, approved technicians with recent locations who have at least one required category
    const freshnessThreshold = new Date(Date.now() - TECHNICIAN_LOCATION_MAX_AGE_SECONDS * 1000);

    const eligibleTechnicians = await this.prisma.technicianProfile.findMany({
      where: {
        isOnline: true,
        onboardingStatus: {
          in: [OnboardingStatus.APPROVED, OnboardingStatus.SUBMITTED],
        },
        lastLocationUpdatedAt: {
          gte: freshnessThreshold,
        },
        latitude: { not: null },
        longitude: { not: null },
        ...(categoryIds.length > 0 ? {
          skills: {
            some: {
              id: { in: categoryIds },
            },
          },
        } : {}),
      },
      include: {
        user: true,
      }
    });

    const matches = [];
    for (const tech of eligibleTechnicians) {
      const distance = getDistanceFromLatLonInKm(
        booking.serviceLatitude,
        booking.serviceLongitude,
        tech.latitude!,
        tech.longitude!
      );

      if (distance <= TECHNICIAN_DISPATCH_RADIUS_KM) {
        matches.push({ tech, distance });
      }
    }

    this.logger.log(`[DispatchService] Found ${matches.length} eligible technicians within ${TECHNICIAN_DISPATCH_RADIUS_KM}km.`);

    if (matches.length === 0) {
      return;
    }

    const expiresAt = new Date(Date.now() + DISPATCH_EXPIRATION_SECONDS * 1000);
    const serviceTitles = booking.items.map((i) => i.serviceTitleSnapshot).join(', ');

    for (const match of matches) {
      const dispatch = await this.prisma.bookingDispatch.upsert({
        where: {
          bookingId_technicianId: {
            bookingId: booking.id,
            technicianId: match.tech.id,
          },
        },
        update: {
          status: 'OFFERED',
          expiresAt,
          distanceKm: match.distance,
        },
        create: {
          bookingId: booking.id,
          technicianId: match.tech.id,
          distanceKm: match.distance,
          status: 'OFFERED',
          expiresAt,
        },
      });

      const payload = {
        bookingId: booking.id,
        bookingNumber: booking.bookingNumber,
        status: booking.status,
        bookingType: booking.bookingType,
        scheduledAt: booking.scheduledAt,
        serviceLocation: {
          latitude: booking.serviceLatitude,
          longitude: booking.serviceLongitude,
          address: booking.snapshotAddress,
          landmark: booking.snapshotLandmark,
          city: booking.snapshotCity
        },
        dispatchId: dispatch.id,
        serviceSummary: serviceTitles,
        customerArea: booking.snapshotCity || 'Nearby',
        distanceKm: Number(match.distance.toFixed(1)),
        pricing: {
          subtotal: booking.subtotal,
          discount: booking.discount,
          tax: booking.tax,
          platformFee: booking.platformFee,
          totalAmount: booking.totalAmount,
        },
        totalAmount: booking.totalAmount,
        expiresAt: expiresAt.toISOString(),
      };

      // Persist Notification
      await this.prisma.notification.create({
        data: {
          recipientId: match.tech.user.id,
          type: 'booking:incoming',
          title: 'New Service Request',
          message: `Distance: ${match.distance.toFixed(1)} km`,
          bookingId: booking.id,
          metadata: payload
        }
      });

      // Emit real-time incoming booking to this specific technician via userId
      this.realtimeService.emitToTechnician(match.tech.user.id, 'booking:incoming', payload);
      
      // Dispatch OS push notification for background delivery
      this.notificationsService.sendBookingRequest(match.tech.user.id, payload);
      
      this.logger.log(`[DispatchService] Emitted booking:incoming to techId=${match.tech.id} userId=${match.tech.user.id} (${match.distance.toFixed(1)}km)`);
    }
  }
}
