import { Injectable, Logger, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/services/realtime.service';

@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
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

    if (new Date() > dispatch.expiresAt) {
      throw new ConflictException('This offer has expired');
    }

    // Atomic transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Lock the booking and verify status
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
      });

      if (!booking || (booking.status !== 'TECHNICIAN_SEARCHING' && booking.status !== 'PENDING_MATCHING')) {
        throw new ConflictException('Booking is no longer available');
      }

      // 2. Update booking status and assigned technician
      const updatedBooking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'TECHNICIAN_ASSIGNED',
          technicianId: technician.id,
          assignedAt: new Date(),
          acceptedAt: new Date(),
        },
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
      bookingNumber: result.bookingNumber,
      customerId: result.customerId,
      status: result.status,
      technicianId: technician.id,
      updatedAt: result.updatedAt.toISOString(),
      engineer: {
        name: technician.user.name || 'Technician',
        photo: technician.profilePhoto || null,
        rating: '4.9',
        completedJobs: 42,
        distance: '2.5 km',
        isTopRated: true,
      },
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

    return { success: true };
  }
}
