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

  async acceptBooking(userId: string, bookingId: string) {
    this.logger.log(`[AssignmentService] User ${userId} attempting to accept booking ${bookingId}`);

    const technician = await this.prisma.technicianProfile.findUnique({
      where: { userId },
      include: { user: true }
    });

    if (!technician) {
      throw new NotFoundException('Technician profile not found');
    }

    const dispatch = await this.prisma.bookingDispatch.findUnique({
      where: {
        bookingId_technicianId: {
          bookingId,
          technicianId: technician.id,
        },
      },
    });

    if (!dispatch) {
      throw new NotFoundException('Dispatch offer not found for this booking');
    }

    if (dispatch.status !== 'OFFERED') {
      throw new ConflictException(`This offer is no longer valid (status: ${dispatch.status})`);
    }

    // Removing expiration check to allow accepting from notification/nearby anytime
    // as long as the booking itself is still available

    // Atomic transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Lock the booking and verify status
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
      });

      if (!booking || (booking.status !== 'TECHNICIAN_SEARCHING' && booking.status !== 'PENDING_MATCHING')) {
        throw new ConflictException('Booking is no longer available');
      }

      // Calculate 20% commission to reserve
      const commissionAmount = booking.totalAmount * 0.20;

      // Reserve funds from technician's wallet atomically
      await this.walletService.reserveAmount(technician.id, commissionAmount, bookingId, tx);

      // 2. Update booking status and assigned technician atomically to prevent racing
      const updatedCount = await tx.booking.updateMany({
        where: { id: bookingId, status: booking.status },
        data: {
          status: 'TECHNICIAN_ASSIGNED',
          technicianId: technician.id,
          assignedAt: new Date(),
          acceptedAt: new Date(),
        },
      });

      if (!updatedCount || updatedCount.count === 0) {
        throw new ConflictException('Booking was accepted by another technician');
      }

      // Fetch the updated booking for event dispatching
      const updatedBooking = await tx.booking.findUnique({
        where: { id: bookingId }
      });

      // 3. Mark this dispatch as ACCEPTED
      await tx.bookingDispatch.update({
        where: { id: dispatch.id },
        data: {
          status: 'ACCEPTED',
          respondedAt: new Date(),
        },
      });

      // 4. Mark all other dispatches for this booking as SUPERSEDED
      await tx.bookingDispatch.updateMany({
        where: {
          bookingId,
          id: { not: dispatch.id },
          status: 'OFFERED',
        },
        data: {
          status: 'SUPERSEDED',
        },
      });

      // 5. Add to history
      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: 'TECHNICIAN_ASSIGNED',
          changedBy: userId,
          changedByType: 'TECHNICIAN',
          reason: 'Technician accepted booking',
        },
      });

      return updatedBooking;
    });

    this.logger.log(`[AssignmentService] Booking ${bookingId} successfully assigned to ${technician.id}`);

    // Emit real-time events to ALL technicians to immediately clear their feeds
    const allDispatches = await this.prisma.bookingDispatch.findMany({
      where: { bookingId },
      include: { technician: { include: { user: true } } },
    });

    for (const d of allDispatches) {
      this.realtimeService.emitToTechnician(d.technician.user.id, 'booking:no-longer-available', {
        bookingId,
        reason: d.status === 'ACCEPTED' ? 'ACCEPTED_BY_YOU' : 'ASSIGNED_TO_OTHER',
      });
      
      if (d.status !== 'ACCEPTED') {
        // Silently send background push to cancel the alarm on other devices
        this.notificationsService.sendBookingUpdate(
          d.technician.user.id,
          'Booking Assigned',
          'This booking has been assigned to another technician.',
          { type: 'booking:no-longer-available', bookingId }
        );
      }
    }

    // Delete the incoming booking notifications for ALL technicians to clear their feeds
    await this.prisma.notification.deleteMany({
      where: {
        bookingId,
        type: 'booking:incoming',
      },
    });

    // Emit to customer
    this.realtimeService.emitBookingEvent(bookingId, 'booking:assigned', {
      bookingId,
      bookingNumber: result!.bookingNumber,
      customerId: result!.customerId,
      status: result!.status,
      technicianId: technician.id,
      updatedAt: result!.updatedAt.toISOString(),
      engineer: {
        name: technician.user.name || 'Technician',
        photo: technician.profilePhoto || null,
        rating: '4.9',
        completedJobs: 42,
        distance: '2.5 km',
        isTopRated: true,
      },
    });

    // Invalidate technician's performance metrics (acceptance rate changes after accepting)
    this.realtimeService.emitToTechnician(technician.user.id, REALTIME_EVENTS.TECHNICIAN.PERFORMANCE_UPDATED, {
      technicianId: technician.id,
      triggeredBy: 'booking_accepted',
      bookingId,
      updatedAt: new Date().toISOString(),
    });

    return result;
  }

  async rejectBooking(userId: string, bookingId: string) {
    const technician = await this.prisma.technicianProfile.findUnique({
      where: { userId },
    });

    if (!technician) throw new NotFoundException('Technician profile not found');

    const dispatch = await this.prisma.bookingDispatch.findUnique({
      where: {
        bookingId_technicianId: {
          bookingId,
          technicianId: technician.id,
        },
      },
    });

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

    // Emit performance update — rejecting a booking affects acceptance rate
    const techWithUser = await this.prisma.technicianProfile.findUnique({
      where: { id: technician.id },
      include: { user: { select: { id: true } } },
    });
    if (techWithUser?.user) {
      this.realtimeService.emitToTechnician(techWithUser.user.id, REALTIME_EVENTS.TECHNICIAN.PERFORMANCE_UPDATED, {
        technicianId: technician.id,
        triggeredBy: 'booking_rejected',
        bookingId,
        updatedAt: new Date().toISOString(),
      });
    }

    return { success: true };
  }
}
