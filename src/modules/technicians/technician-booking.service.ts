import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { REALTIME_EVENTS } from '../../realtime/constants/realtime-events.constant';
import { BookingStatus, BookingSparePart } from '../../generated/prisma/client';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';
import * as crypto from 'crypto';

@Injectable()
export class TechnicianBookingService {
  private readonly logger = new Logger(TechnicianBookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async getTechnicianProfile(userId: string) {
    const technician = await this.prisma.technicianProfile.findUnique({
      where: { userId },
      include: { user: true },
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
        OR: [
          { technicianId: technician.id },
          { items: { some: { technicianId: technician.id } } },
        ],
        ...(Object.keys(statusFilter).length > 0 ? { status: statusFilter } : {}),
      },
      include: {
        customer: true,
        address: true,
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

    const hasAccess =
      booking.technicianId === technician.id ||
      booking.items?.some((item: any) => item.technicianId === technician.id);

    if (!hasAccess) {
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

    // Idempotency: if already in the target status, just return the booking
    if (booking.status === nextStatus) {
      return booking;
    }

    if (nextStatus === 'SERVICE_STARTED') {
      if (!otp) {
        throw new BadRequestException('OTP is required to start service');
      }
      // Strict backend validation against the actual OTP stored in the DB.
      if (!booking.otp || otp !== booking.otp) {
        throw new BadRequestException('Invalid OTP. Please ask the customer for the 4-digit code.');
      }
    }

    if (nextStatus === 'SERVICE_COMPLETED' || nextStatus === 'COMPLETED') {
      if (!otp) {
        throw new BadRequestException('Happy Code is required to complete service');
      }
      if (!booking.happyCode || otp !== booking.happyCode) {
        throw new BadRequestException('Invalid Happy Code. Please ask the customer for the 4-digit code.');
      }
    }

    const updatedBooking = await this.prisma.$transaction(async (tx) => {
      // Happy Code generation has been moved to a separate endpoint called when clicking 'End Service'
      const updatedCount = await tx.booking.updateMany({
        where: { id: bookingId, status: booking.status },
        data: {
          status: nextStatus,
          ...(nextStatus === 'SERVICE_STARTED' ? { startedAt: new Date() } : {}),
          ...(nextStatus === 'SERVICE_COMPLETED' || nextStatus === 'COMPLETED' ? { completedAt: new Date() } : {}),
        },
      });

      if (!updatedCount || updatedCount.count === 0) {
        throw new ConflictException('Booking status was already changed by another request');
      }

      const b = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!b) throw new ConflictException('Booking not found after update');

      // Handle Financial Settlement Atomically
      if (nextStatus === 'SERVICE_COMPLETED' || nextStatus === 'COMPLETED') {
        // We must fetch spare parts for accurate calculation.
        const fullBooking = await tx.booking.findUnique({
          where: { id: bookingId },
          include: { spareParts: true },
        });

        const sparePartsTotal = fullBooking?.spareParts.reduce((sum, part) => sum + (part.unitPrice * part.quantity), 0) || 0;
        const commissionableAmount = b.subtotal + sparePartsTotal;
        
        const companyCommission = commissionableAmount * 0.20;
        const technicianEarnings = commissionableAmount - companyCommission;

        // Add technician earnings directly to available balance
        await this.walletService.addEarning(technician.id, technicianEarnings, bookingId, tx);

        // Save GST (tax) and company commission to the Admin Wallet separately
        await this.walletService.addAdminSettlement(companyCommission, b.tax, bookingId, tx);
      }

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

      return b;
    });

    const techName = technician.user?.name || 'Your technician';

    this.realtimeService.emitBookingEvent(bookingId, REALTIME_EVENTS.BOOKING.STATUS_CHANGED, {
      bookingId,
      bookingNumber: booking.bookingNumber,
      customerId: booking.customerId,
      technicianId: technician.id,
      status: nextStatus,
      previousStatus: booking.status,
      happyCode: updatedBooking!.happyCode, // Pass happy code to customer track service
      technician: {
        id: technician.id,
        fullName: techName,
        phone: technician.user?.phone || null,
        profilePhoto: technician.profilePhoto || null,
      },
      updatedAt: new Date().toISOString(),
    });

    // Asynchronous non-blocking push notification to customer
    if (booking.customerId) {
      let pushTitle = 'Booking Update';
      let pushBody = `Your booking #${booking.bookingNumber} status was updated to ${nextStatus}.`;

      switch (nextStatus) {
        case 'TECHNICIAN_ON_THE_WAY':
          pushTitle = 'Technician En Route 🚗';
          pushBody = `${techName} is on the way to your address.`;
          break;
        case 'TECHNICIAN_ARRIVED':
          pushTitle = 'Technician Arrived 📍';
          pushBody = `${techName} has arrived at your location.`;
          break;
        case 'SERVICE_STARTED':
          pushTitle = 'Service Started ⚡';
          pushBody = `Your service has officially begun.`;
          break;
        case 'SERVICE_COMPLETED':
        case 'COMPLETED':
          pushTitle = 'Service Completed 🎉';
          pushBody = `Your service #${booking.bookingNumber} has been successfully completed.`;
          break;
      }

      this.notificationsService
        .sendBookingUpdate(booking.customerId, pushTitle, pushBody, {
          type: 'BOOKING_STATUS_UPDATE',
          bookingId,
          status: nextStatus,
          happyCode: updatedBooking?.happyCode,
          technicianId: technician.id,
          technicianName: techName,
        })
        .catch((err) => {
          this.logger.warn(`Failed to dispatch customer push notification: ${err?.message}`);
        });
    }

    // After any terminal status transition, invalidate the technician's performance cache
    // so the UI reflects updated metrics (jobsCompleted, completionRate) in realtime
    const terminalStatuses: string[] = ['SERVICE_COMPLETED', 'COMPLETED', 'CANCELLED', 'FAILED'];
    if (terminalStatuses.includes(nextStatus)) {
      this.realtimeService.emitToTechnician(userId, REALTIME_EVENTS.TECHNICIAN.PERFORMANCE_UPDATED, {
        technicianId: technician.id,
        triggeredBy: 'booking_status_change',
        bookingId,
        newStatus: nextStatus,
        updatedAt: new Date().toISOString(),
      });
    }

    return updatedBooking;
  }

  async generateHappyCode(userId: string, bookingId: string) {
    const technician = await this.getTechnicianProfile(userId);

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking || booking.technicianId !== technician.id) {
      throw new ForbiddenException('You do not have access to this booking');
    }

    if (booking.status !== 'SERVICE_STARTED') {
      throw new BadRequestException('Cannot generate Happy Code unless service is started');
    }

    if (booking.happyCode) {
      return { happyCode: booking.happyCode }; // Return existing if already generated
    }

    const happyCode = crypto.randomInt(1000, 10000).toString();

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { happyCode },
    });

    // Emit real-time event to customer so they can see the happy code
    this.realtimeService.emitBookingEvent(bookingId, REALTIME_EVENTS.BOOKING.STATUS_CHANGED, {
      bookingId,
      bookingNumber: booking.bookingNumber,
      customerId: booking.customerId,
      status: booking.status,
      happyCode,
      updatedAt: new Date().toISOString(),
    });

    return { happyCode };
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
    const tax = Math.round((subtotal + sparePartsTotal) * 0.18);
    const totalAmount = subtotal + sparePartsTotal + tax - booking.discount;

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { tax, totalAmount },
    });
  }
}
