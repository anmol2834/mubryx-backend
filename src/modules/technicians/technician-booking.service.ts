import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { REALTIME_EVENTS } from '../../realtime/constants/realtime-events.constant';
import { BookingStatus, BookingSparePart } from '../../generated/prisma/client';

@Injectable()
export class TechnicianBookingService {
  private readonly logger = new Logger(TechnicianBookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

  private async getTechnicianProfile(userId: string) {
    const technician = await this.prisma.technicianProfile.findUnique({
      where: { userId },
    });
    if (!technician) {
      throw new ForbiddenException('Technician profile not found');
    }
    return technician;
  }

  async getTechnicianBookings(userId: string, tab?: 'active' | 'completed') {
    const technician = await this.getTechnicianProfile(userId);
    
    let statusFilter: any = {};
    if (tab === 'active') {
      statusFilter = {
        in: [
          'TECHNICIAN_ASSIGNED',
          'TECHNICIAN_ACCEPTED',
          'TECHNICIAN_ON_THE_WAY',
          'TECHNICIAN_ARRIVED',
          'SERVICE_STARTED',
          'PAYMENT_PENDING'
        ],
      };
    } else if (tab === 'completed') {
      statusFilter = {
        in: ['SERVICE_COMPLETED', 'COMPLETED', 'CANCELLED', 'FAILED'],
      };
    }

    const bookings = await this.prisma.booking.findMany({
      where: {
        technicianId: technician.id,
        ...(Object.keys(statusFilter).length > 0 ? { status: statusFilter } : {}),
      },
      include: {
        customer: true,
        items: { include: { service: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    return bookings;
  }

  async getTechnicianBookingById(userId: string, bookingId: string) {
    const technician = await this.getTechnicianProfile(userId);

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: true,
        address: true,
        items: { include: { service: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        spareParts: true,
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.technicianId !== technician.id) {
      throw new ForbiddenException('You do not have access to this booking');
    }

    return booking;
  }

  async updateBookingStatus(userId: string, bookingId: string, nextStatus: BookingStatus, otp?: string) {
    const technician = await this.getTechnicianProfile(userId);

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking || booking.technicianId !== technician.id) {
      throw new ForbiddenException('You do not have access to this booking');
    }

    if (nextStatus === 'SERVICE_STARTED') {
      if (!otp) {
        throw new BadRequestException('OTP is required to start service');
      }
      // Strict backend validation against the actual OTP stored in the DB.
      if (otp !== booking.otp) {
        throw new BadRequestException('Invalid OTP. Please ask the customer for the 4-digit code.');
      }
    }

    // Idempotency: if already in the target status, just return the booking
    if (booking.status === nextStatus) {
      return booking;
    }

    const updatedBooking = await this.prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: nextStatus,
          ...(nextStatus === 'SERVICE_STARTED' ? { startedAt: new Date() } : {}),
          ...(nextStatus === 'SERVICE_COMPLETED' ? { completedAt: new Date() } : {}),
        },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: booking.status,
          toStatus: nextStatus,
          changedBy: userId,
          changedByType: 'TECHNICIAN',
          reason: `Technician updated status to ${nextStatus}`,
        },
      });

      // if (nextStatus === 'SERVICE_COMPLETED' || nextStatus === 'COMPLETED') {
      //   // User strictly requested to wipe the entire history for this booking once completed
      //   await tx.bookingStatusHistory.deleteMany({
      //     where: { bookingId },
      //   });
      // }

      return b;
    });

    this.realtimeService.emitBookingEvent(bookingId, REALTIME_EVENTS.BOOKING.STATUS_CHANGED, {
      bookingId,
      bookingNumber: booking.bookingNumber,
      customerId: booking.customerId,
      status: nextStatus,
      previousStatus: booking.status,
      updatedAt: new Date().toISOString(),
    });

    return updatedBooking;
  }

  async addSparePart(userId: string, bookingId: string, item: { name: string; category?: string; unitPrice: number; quantity: number }) {
    const technician = await this.getTechnicianProfile(userId);

    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.technicianId !== technician.id) {
      throw new ForbiddenException('You do not have access to this booking');
    }

    const newPart = await this.prisma.bookingSparePart.create({
      data: {
        bookingId,
        name: item.name,
        category: item.category,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
      },
    });

    await this.recalculateBookingPricing(bookingId);
    return newPart;
  }

  async removeSparePart(userId: string, bookingId: string, partId: string) {
    const technician = await this.getTechnicianProfile(userId);

    const part = await this.prisma.bookingSparePart.findUnique({ where: { id: partId }, include: { booking: true } });
    if (!part || part.booking.technicianId !== technician.id || part.bookingId !== bookingId) {
      throw new ForbiddenException('You do not have access to this spare part');
    }

    await this.prisma.bookingSparePart.delete({ where: { id: partId } });
    await this.recalculateBookingPricing(bookingId);
    return { success: true };
  }

  async updateSparePartQuantity(userId: string, bookingId: string, partId: string, quantity: number) {
    const technician = await this.getTechnicianProfile(userId);

    const part = await this.prisma.bookingSparePart.findUnique({ where: { id: partId }, include: { booking: true } });
    if (!part || part.booking.technicianId !== technician.id || part.bookingId !== bookingId) {
      throw new ForbiddenException('You do not have access to this spare part');
    }

    const updated = await this.prisma.bookingSparePart.update({
      where: { id: partId },
      data: { quantity },
    });

    await this.recalculateBookingPricing(bookingId);
    return updated;
  }

  private async recalculateBookingPricing(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { items: true, spareParts: true },
    });
    if (!booking) return;

    const subtotal = booking.items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
    const sparePartsTotal = booking.spareParts.reduce((sum, part) => sum + (part.unitPrice * part.quantity), 0);
    const tax = Math.round(subtotal * 0.05); // Only taxing service for now
    const totalAmount = subtotal + sparePartsTotal + tax + booking.platformFee - booking.discount;

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { totalAmount },
    });
  }
}
