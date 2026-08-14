import { Injectable, Logger, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { REALTIME_EVENTS } from '../../realtime/constants/realtime-events.constant';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly notificationsService: NotificationsService,
    private readonly walletService: WalletService,
  ) {}

  async acceptBooking(userId: string, targetId: string, bookingItemIdParam?: string) {
    this.logger.log(`[AssignmentService] User ${userId} attempting to accept booking target=${targetId} item=${bookingItemIdParam}`);

    const technician = await this.prisma.technicianProfile.findUnique({
      where: { userId },
      include: { user: true },
    });

    if (!technician) {
      throw new NotFoundException('Technician profile not found');
    }

    // Resolve dispatch offer: either by bookingItemId or bookingId
    let dispatch = null;
    if (bookingItemIdParam) {
      dispatch = await this.prisma.bookingDispatch.findUnique({
        where: {
          bookingItemId_technicianId: {
            bookingItemId: bookingItemIdParam,
            technicianId: technician.id,
          },
        },
      });
    }

    if (!dispatch) {
      // Try treating targetId as bookingItemId
      dispatch = await this.prisma.bookingDispatch.findUnique({
        where: {
          bookingItemId_technicianId: {
            bookingItemId: targetId,
            technicianId: technician.id,
          },
        },
      });
    }

    if (!dispatch) {
      // Fallback: search by bookingId for this technician with OFFERED status
      dispatch = await this.prisma.bookingDispatch.findFirst({
        where: {
          bookingId: targetId,
          technicianId: technician.id,
          status: 'OFFERED',
        },
      });
    }

    if (!dispatch) {
      throw new NotFoundException('Dispatch offer not found for this service');
    }

    if (dispatch.status !== 'OFFERED') {
      throw new ConflictException(`This offer is no longer valid (status: ${dispatch.status})`);
    }

    const bookingItemId = dispatch.bookingItemId;
    const bookingId = dispatch.bookingId;

    // Atomic transaction for assigning the specific item
    const { updatedBooking, bookingItem } = await this.prisma.$transaction(async (tx) => {
      // 1. Lock the booking item and verify availability
      const item = await tx.bookingItem.findUnique({
        where: { id: bookingItemId },
        include: { booking: true },
      });

      if (!item || (item.status !== 'TECHNICIAN_SEARCHING' && item.status !== 'PENDING_MATCHING')) {
        throw new ConflictException('This service item is no longer available');
      }

      // Validate eligibility (20% of item line total)
      const eligibilityAmount = item.lineTotal * 0.20;
      await this.walletService.validateEligibility(technician.id, eligibilityAmount, tx);

      // 2. Atomically claim the dispatch offer — only one technician can transition
      //    the dispatch from OFFERED → ACCEPTED. If count = 0, another technician won.
      const dispatchClaimed = await tx.bookingDispatch.updateMany({
        where: { id: dispatch.id, status: 'OFFERED' },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      });

      if (!dispatchClaimed || dispatchClaimed.count === 0) {
        throw new ConflictException('This offer has already been accepted or has expired');
      }

      // 3. Update booking item status and assigned technician
      const updatedCount = await tx.bookingItem.updateMany({
        where: { id: bookingItemId, status: item.status },
        data: {
          status: 'TECHNICIAN_ASSIGNED',
          technicianId: technician.id,
          assignedAt: new Date(),
          acceptedAt: new Date(),
        },
      });

      if (!updatedCount || updatedCount.count === 0) {
        throw new ConflictException('Service item was accepted by another technician');
      }

      // 4. Mark all other dispatches for this booking item as SUPERSEDED
      await tx.bookingDispatch.updateMany({
        where: {
          bookingItemId,
          id: { not: dispatch.id },
          status: 'OFFERED',
        },
        data: {
          status: 'SUPERSEDED',
        },
      });

      // 5. Evaluate overall booking status across all items
      const allItems = await tx.bookingItem.findMany({
        where: { bookingId },
      });

      const unassignedRemaining = allItems.some(
        (i) => i.id !== bookingItemId && (i.status === 'PENDING_MATCHING' || i.status === 'TECHNICIAN_SEARCHING'),
      );

      const newBookingStatus = unassignedRemaining ? 'PARTIALLY_ASSIGNED' : 'TECHNICIAN_ASSIGNED';

      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: newBookingStatus,
          technicianId: technician.id,
          assignedAt: new Date(),
          acceptedAt: new Date(),
        },
      });

      // 6. Record in status history
      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: item.booking.status,
          toStatus: newBookingStatus,
          changedBy: userId,
          changedByType: 'TECHNICIAN',
          reason: `Technician accepted service: ${item.serviceTitleSnapshot}`,
          metadata: {
            bookingItemId,
            serviceTitle: item.serviceTitleSnapshot,
            overallStatus: newBookingStatus,
          },
        },
      });

      const updated = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { items: true },
      });

      return { updatedBooking: updated, bookingItem: item };
    });

    this.logger.log(
      `[AssignmentService] BookingItem ${bookingItemId} on booking ${bookingId} successfully assigned to ${technician.id}`,
    );

    // Emit real-time events to all other technicians who received offer for this item
    const allItemDispatches = await this.prisma.bookingDispatch.findMany({
      where: { bookingItemId },
      include: { technician: { include: { user: true } } },
    });

    for (const d of allItemDispatches) {
      if (d.technician?.user?.id) {
        this.realtimeService.emitToTechnician(d.technician.user.id, 'booking:no-longer-available', {
          bookingId,
          bookingItemId,
          reason: d.status === 'ACCEPTED' ? 'ACCEPTED_BY_YOU' : 'ASSIGNED_TO_OTHER',
        });

        if (d.status !== 'ACCEPTED') {
          this.notificationsService.sendBookingUpdate(
            d.technician.user.id,
            'Service Assigned',
            `Service "${bookingItem.serviceTitleSnapshot}" has been assigned to another technician.`,
            { type: 'booking:no-longer-available', bookingId, bookingItemId },
          );
        }
      }
    }

    // Delete the incoming booking notifications for this item for other technicians
    const notificationsToDelete = await this.prisma.notification.findMany({
      where: {
        bookingId,
        type: 'booking:incoming',
      },
    });

    for (const n of notificationsToDelete) {
      const meta = n.metadata as any;
      if (meta?.bookingItemId === bookingItemId && n.recipientId !== technician.user.id) {
        await this.prisma.notification.delete({ where: { id: n.id } }).catch(() => null);
      }
    }

    // Emit to customer
    this.realtimeService.emitBookingEvent(bookingId, 'booking:assigned', {
      bookingId,
      bookingItemId,
      bookingNumber: updatedBooking!.bookingNumber,
      customerId: updatedBooking!.customerId,
      status: updatedBooking!.status,
      technicianId: technician.id,
      updatedAt: updatedBooking!.updatedAt.toISOString(),
      engineer: {
        name: technician.user.name || 'Technician',
        photo: technician.profilePhoto || null,
        rating: '4.9',
        completedJobs: 42,
        distance: '2.5 km',
        isTopRated: true,
      },
    });

    // Notify customer via FCM push
    if (updatedBooking?.customerId) {
      const techName = technician.user.name || 'A technician';
      this.notificationsService
        .sendBookingUpdate(
          updatedBooking.customerId,
          'Technician Assigned! 🛠️',
          `${techName} has been assigned to your service request #${updatedBooking.bookingNumber}.`,
          {
            type: 'BOOKING_STATUS_UPDATE',
            bookingId,
            bookingItemId,
            status: updatedBooking.status,
            technicianId: technician.id,
            technicianName: techName,
          },
        )
        .catch((err) => {
          this.logger.warn(
            `Failed to dispatch push notification to customer ${updatedBooking?.customerId}: ${err?.message}`,
          );
        });
    }

    // Invalidate technician's performance metrics
    this.realtimeService.emitToTechnician(technician.user.id, REALTIME_EVENTS.TECHNICIAN.PERFORMANCE_UPDATED, {
      technicianId: technician.id,
      triggeredBy: 'booking_accepted',
      bookingId,
      bookingItemId,
      updatedAt: new Date().toISOString(),
    });

    return updatedBooking;
  }

  async rejectBooking(userId: string, targetId: string, bookingItemIdParam?: string) {
    const technician = await this.prisma.technicianProfile.findUnique({
      where: { userId },
    });

    if (!technician) throw new NotFoundException('Technician profile not found');

    let dispatch = null;
    if (bookingItemIdParam) {
      dispatch = await this.prisma.bookingDispatch.findUnique({
        where: {
          bookingItemId_technicianId: {
            bookingItemId: bookingItemIdParam,
            technicianId: technician.id,
          },
        },
      });
    }

    if (!dispatch) {
      dispatch = await this.prisma.bookingDispatch.findUnique({
        where: {
          bookingItemId_technicianId: {
            bookingItemId: targetId,
            technicianId: technician.id,
          },
        },
      });
    }

    if (!dispatch) {
      dispatch = await this.prisma.bookingDispatch.findFirst({
        where: {
          bookingId: targetId,
          technicianId: technician.id,
          status: 'OFFERED',
        },
      });
    }

    if (!dispatch) {
      throw new NotFoundException('Dispatch offer not found');
    }

    if (dispatch.status !== 'OFFERED') {
      return { success: true }; // Already responded
    }

    await this.prisma.bookingDispatch.update({
      where: { id: dispatch.id },
      data: {
        status: 'REJECTED',
        respondedAt: new Date(),
      },
    });

    // Emit performance update
    const techWithUser = await this.prisma.technicianProfile.findUnique({
      where: { id: technician.id },
      include: { user: { select: { id: true } } },
    });
    if (techWithUser?.user) {
      this.realtimeService.emitToTechnician(techWithUser.user.id, REALTIME_EVENTS.TECHNICIAN.PERFORMANCE_UPDATED, {
        technicianId: technician.id,
        triggeredBy: 'booking_rejected',
        bookingId: dispatch.bookingId,
        bookingItemId: dispatch.bookingItemId,
        updatedAt: new Date().toISOString(),
      });
    }

    return { success: true };
  }
}

