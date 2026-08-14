import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { REALTIME_EVENTS } from '../../realtime/constants/realtime-events.constant';
import { OnboardingStatus } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

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
      include: {
        items: {
          include: {
            service: true,
          },
        },
      },
    });

    if (!booking) {
      this.logger.error(`[DispatchService] Booking ${bookingId} not found`);
      return;
    }

    const eligibleBookingStatuses = ['TECHNICIAN_SEARCHING', 'PENDING_MATCHING', 'PARTIALLY_ASSIGNED'];
    if (!eligibleBookingStatuses.includes(booking.status)) {
      this.logger.log(
        `[DispatchService] Booking ${bookingId} is in status ${booking.status}. Skipping dispatch.`,
      );
      return;
    }

    if (!booking.serviceLatitude || !booking.serviceLongitude) {
      this.logger.error(`[DispatchService] Booking ${bookingId} lacks service coordinates`);
      return;
    }

    // Identify items that still require technician matching
    const unassignedItems = booking.items.filter(
      (item) => item.status === 'PENDING_MATCHING' || item.status === 'TECHNICIAN_SEARCHING',
    );

    if (unassignedItems.length === 0) {
      this.logger.log(`[DispatchService] No unassigned items needing dispatch for booking=${bookingId}`);
      return;
    }

    const expiresAt = new Date(Date.now() + DISPATCH_EXPIRATION_SECONDS * 1000);

    for (const item of unassignedItems) {
      const categoryId = item.service?.categoryId;
      if (!categoryId) {
        this.logger.warn(
          `[DispatchService] BookingItem ${item.id} (${item.serviceTitleSnapshot}) has no resolvable categoryId. Skipping item dispatch.`,
        );
        continue;
      }

      this.logger.log(
        `[DispatchService] Dispatching BookingItem ${item.id} (${item.serviceTitleSnapshot}) for categoryId=${categoryId}`,
      );

      // Find all online, approved technicians who possess THIS specific skill
      const eligibleTechnicians = await this.prisma.technicianProfile.findMany({
        where: {
          isOnline: true,
          onboardingStatus: {
            in: [OnboardingStatus.APPROVED, OnboardingStatus.SUBMITTED],
          },
          latitude: { not: null },
          longitude: { not: null },
          skills: {
            some: {
              id: categoryId,
            },
          },
        },
        include: {
          user: true,
        },
      });

      const matches = [];
      for (const tech of eligibleTechnicians) {
        const distance = getDistanceFromLatLonInKm(
          booking.serviceLatitude,
          booking.serviceLongitude,
          tech.latitude!,
          tech.longitude!,
        );

        if (distance <= TECHNICIAN_DISPATCH_RADIUS_KM) {
          matches.push({ tech, distance });
        }
      }

      this.logger.log(
        `[DispatchService] Found ${matches.length} eligible technicians within ${TECHNICIAN_DISPATCH_RADIUS_KM}km for item ${item.id} (${item.serviceTitleSnapshot}).`,
      );

      for (const match of matches) {
        const dispatch = await this.prisma.bookingDispatch.upsert({
          where: {
            bookingItemId_technicianId: {
              bookingItemId: item.id,
              technicianId: match.tech.id,
            },
          },
          update: {
            status: 'OFFERED',
            expiresAt,
            distanceKm: match.distance,
            bookingId: booking.id,
          },
          create: {
            bookingId: booking.id,
            bookingItemId: item.id,
            technicianId: match.tech.id,
            distanceKm: match.distance,
            status: 'OFFERED',
            expiresAt,
          },
        });

        const itemTax = Math.round(item.lineTotal * 0.18);
        const itemTotalWithTax = item.lineTotal + itemTax;

        const payload = {
          type: 'booking:incoming',
          dispatchId: dispatch.id,
          bookingId: booking.id,
          bookingItemId: item.id,
          bookingNumber: booking.bookingNumber,
          status: item.status,
          bookingStatus: booking.status,
          bookingType: booking.bookingType,
          scheduledAt: booking.scheduledAt,
          serviceLocation: {
            latitude: booking.serviceLatitude,
            longitude: booking.serviceLongitude,
            address: booking.snapshotAddress,
            landmark: booking.snapshotLandmark,
            city: booking.snapshotCity,
          },
          serviceSummary: item.serviceTitleSnapshot,
          categoryName: item.categoryNameSnapshot,
          itemQuantity: item.quantity,
          itemPrice: item.unitPrice,
          itemTotal: item.lineTotal,
          customerArea: booking.snapshotCity || 'Nearby',
          distanceKm: Number(match.distance.toFixed(1)),
          pricing: {
            subtotal: item.lineTotal,
            discount: item.discount,
            tax: itemTax,
            totalAmount: itemTotalWithTax,
          },
          totalAmount: itemTotalWithTax,
          expiresAt: expiresAt.toISOString(),
        };

        // Persist Notification in DB
        await this.prisma.notification.create({
          data: {
            recipientId: match.tech.user.id,
            type: 'booking:incoming',
            title: `New Service Request: ${item.serviceTitleSnapshot}`,
            message: `${item.serviceTitleSnapshot} • Distance: ${match.distance.toFixed(1)} km`,
            bookingId: booking.id,
            metadata: payload,
          },
        });

        // Emit real-time incoming booking to this specific technician room
        this.realtimeService.emitToTechnician(match.tech.user.id, 'booking:incoming', payload);

        // Emit realtime notification event
        this.realtimeService.emitNotification(match.tech.user.id, {
          id: dispatch.id,
          userId: match.tech.user.id,
          type: 'booking:incoming',
          title: `New Service Request: ${item.serviceTitleSnapshot}`,
          body: `${item.serviceTitleSnapshot} • Distance: ${match.distance.toFixed(1)} km`,
          data: payload,
          createdAt: new Date().toISOString(),
        });

        // Dispatch OS push notification for background delivery
        this.notificationsService.sendBookingRequest(match.tech.user.id, payload);

        this.logger.log(
          `[DispatchService] Emitted booking:incoming & notification for itemId=${item.id} to techId=${match.tech.id} userId=${match.tech.user.id} (${match.distance.toFixed(1)}km)`,
        );
      }
    }
  }
}
