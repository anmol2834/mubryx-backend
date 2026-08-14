import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import {
  BookingStatus,
  PaymentMethod,
} from '../../generated/prisma/client';

// ─── Status Machine ───────────────────────────────────────────────────────────

const CANCELLABLE_STATUSES: BookingStatus[] = [
  'PENDING_MATCHING',
  'TECHNICIAN_SEARCHING',
  'PARTIALLY_ASSIGNED',
  'TECHNICIAN_ASSIGNED',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

import * as crypto from 'crypto';

function generateBookingNumber(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  // 5-digit random suffix (10000–99999)
  const seq = String(Math.floor(Math.random() * 90000) + 10000);
  return `MBX-${yyyy}${mm}${dd}-${seq}`;
}

function generateOTP(): string {
  return crypto.randomInt(1000, 10000).toString();
}

function calculatePricing(items: Array<{ unitPrice: number; quantity: number }>) {
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const discount = 0; // Coupon discount — reserved for future
  const tax = Math.round(subtotal * 0.18);
  const totalAmount = subtotal - discount + tax;
  return { subtotal, discount, tax, totalAmount };
}

// ─── Response Formatter ───────────────────────────────────────────────────────

function formatBookingResponse(booking: any) {
  return {
    id: booking.id,
    bookingId: booking.id,
    bookingNumber: booking.bookingNumber,
    status: booking.status,
    bookingType: booking.bookingType,
    scheduledAt: booking.scheduledAt ?? null,
    paymentMethod: booking.paymentMethod,
    paymentStatus: booking.paymentStatus,
    serviceAddress: {
      label: booking.snapshotLabel,
      completeAddress: booking.snapshotAddress,
      landmark: booking.snapshotLandmark ?? null,
      city: booking.snapshotCity ?? null,
      state: booking.snapshotState ?? null,
      postalCode: booking.snapshotPostalCode ?? null,
      latitude: booking.serviceLatitude ?? null,
      longitude: booking.serviceLongitude ?? null,
    },
    items: (booking.items || []).map((item: any) => ({
      id: item.id,
      serviceId: item.serviceId,
      title: item.serviceTitleSnapshot,
      category: item.categoryNameSnapshot ?? null,
      duration: item.durationSnapshot ?? null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      lineTotal: item.lineTotal,
      status: item.status,
      technicianId: item.technicianId ?? null,
      technician: item.technician
        ? {
            id: item.technician.id,
            fullName: item.technician.fullName,
            profilePhoto: item.technician.profilePhoto,
            rating: item.technician.rating,
          }
        : null,
      assignedAt: item.assignedAt ?? null,
      acceptedAt: item.acceptedAt ?? null,
      startedAt: item.startedAt ?? null,
      completedAt: item.completedAt ?? null,
      cancelledAt: item.cancelledAt ?? null,
      cancellationReason: item.cancellationReason ?? null,
    })),
    pricing: {
      subtotal: booking.subtotal,
      discount: booking.discount,
      tax: booking.tax,
      total: booking.totalAmount,
    },
    customerNotes: booking.customerNotes ?? null,
    technicianId: booking.technicianId ?? null,
    technician: booking.technician
      ? {
          id: booking.technician.id,
          fullName: booking.technician.fullName,
          profilePhoto: booking.technician.profilePhoto,
          rating: booking.technician.rating,
        }
      : null,
    otp: booking.otp ?? null,
    happyCode: booking.happyCode ?? null,
    cancelledAt: booking.cancelledAt ?? null,
    cancellationReason: booking.cancellationReason ?? null,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}

import { RealtimeService } from '../../realtime/services/realtime.service';
import { REALTIME_EVENTS } from '../../realtime/constants/realtime-events.constant';

import { DispatchService } from './dispatch.service';

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    private readonly dispatchService: DispatchService,
  ) {}

  // ─── Create Booking ─────────────────────────────────────────────────────────

  async createBooking(customerId: string, dto: CreateBookingDto) {
    this.logger.log(`[createBooking] Starting for customer=${customerId} idempotency=${dto.idempotencyKey}`);

    // ── 1. Idempotency check ───────────────────────────────────────────────────
    const existing = await this.prisma.booking.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { items: true },
    });

    if (existing) {
      if (existing.customerId !== customerId) {
        throw new ForbiddenException('Idempotency key belongs to a different customer.');
      }
      this.logger.warn(`[createBooking] Idempotent retry detected. Returning existing booking ${existing.bookingNumber}`);
      return { alreadyCreated: true, ...formatBookingResponse(existing) };
    }

    // ── 2. Validate address ────────────────────────────────────────────────────
    const address = await this.prisma.customerAddress.findUnique({
      where: { id: dto.addressId },
    });

    if (!address) {
      throw new NotFoundException({
        message: 'Service address not found.',
        errorCode: 'BOOKING_ADDRESS_NOT_FOUND',
      });
    }

    if (address.customerId !== customerId) {
      throw new ForbiddenException({
        message: 'This address does not belong to your account.',
        errorCode: 'BOOKING_ADDRESS_NOT_OWNED',
      });
    }

    // ── 3. Validate schedule ───────────────────────────────────────────────────
    let scheduledAt: Date | null = null;

    if (dto.bookingType === 'SCHEDULED') {
      if (!dto.scheduledAt) {
        throw new BadRequestException({
          message: 'scheduledAt is required for SCHEDULED bookings.',
          errorCode: 'BOOKING_INVALID_SCHEDULE',
        });
      }
      scheduledAt = new Date(dto.scheduledAt);
      if (scheduledAt <= new Date()) {
        throw new BadRequestException({
          message: 'Scheduled time must be in the future.',
          errorCode: 'BOOKING_INVALID_SCHEDULE',
        });
      }
    }

    // ── 4. Load & validate active cart ────────────────────────────────────────
    const cart = await this.prisma.cart.findFirst({
      where: { customerId, status: 'ACTIVE' },
      include: {
        items: {
          include: {
            service: {
              include: { Category: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new BadRequestException({
        message: 'Your cart is empty. Please add services before booking.',
        errorCode: 'BOOKING_CART_EMPTY',
      });
    }

    // ── 5. Validate all services are active ───────────────────────────────────
    const unavailableServices = cart.items.filter(
      (i) => !i.service || !i.service.isActive,
    );

    if (unavailableServices.length > 0) {
      const names = unavailableServices.map((i) => i.service?.title ?? i.serviceId).join(', ');
      throw new BadRequestException({
        message: `The following services are no longer available: ${names}. Please remove them from your cart.`,
        errorCode: 'BOOKING_SERVICE_UNAVAILABLE',
      });
    }

    // ── 6. Server-authoritative pricing ───────────────────────────────────────
    const pricedItems = cart.items.map((item) => {
      const unitPrice = item.service.discountPrice ?? item.service.price;
      return {
        serviceId: item.serviceId,
        serviceTitleSnapshot: item.service.title,
        categoryNameSnapshot: item.service.Category?.name ?? null,
        durationSnapshot: item.service.duration ?? null,
        quantity: item.quantity,
        unitPrice,
        discount: 0,
        lineTotal: unitPrice * item.quantity,
      };
    });

    const pricing = calculatePricing(pricedItems);

    // ── 7. Generate unique booking number (retry on collision) ─────────────────
    let bookingNumber = generateBookingNumber();
    let attempts = 0;

    while (attempts < 5) {
      const collision = await this.prisma.booking.findUnique({
        where: { bookingNumber },
      });
      if (!collision) break;
      bookingNumber = generateBookingNumber();
      attempts++;
    }

    this.logger.log(`[createBooking] Creating booking ${bookingNumber} with ${pricedItems.length} items. Total=₹${pricing.totalAmount}`);

    // ── 8. Transactional booking creation ─────────────────────────────────────
    let newBooking: any;

    try {
      newBooking = await this.prisma.$transaction(async (tx) => {
        // a. Create booking
        const booking = await tx.booking.create({
          data: {
            bookingNumber,
            customerId,
            addressId: dto.addressId,
            idempotencyKey: dto.idempotencyKey,

            // Address snapshot (immutable)
            snapshotLabel: address.label,
            snapshotAddress: address.completeAddress,
            snapshotLandmark: address.landmark ?? null,
            snapshotCity: address.city ?? null,
            snapshotState: address.state ?? null,
            snapshotPostalCode: address.postalCode ?? null,
            serviceLatitude: address.latitude ?? null,
            serviceLongitude: address.longitude ?? null,

            // Customer current GPS (optional, separate from service location)
            customerCurrentLat: dto.customerCurrentLocation?.latitude ?? null,
            customerCurrentLng: dto.customerCurrentLocation?.longitude ?? null,

            // Schedule
            bookingType: dto.bookingType ?? 'ASAP',
            scheduledAt,

            // Status
            status: 'TECHNICIAN_SEARCHING',

            // Payment
            paymentMethod: (dto.paymentMethod as PaymentMethod),
            paymentStatus: 'PENDING',

            // Pricing
            subtotal: pricing.subtotal,
            discount: pricing.discount,
            tax: pricing.tax,
            totalAmount: pricing.totalAmount,
            couponCode: dto.couponCode ?? null,
            otp: generateOTP(),

            // Notes
            customerNotes: dto.notes ?? null,
          },
          include: { items: true },
        });

        // b. Create booking items (price snapshot)
        await tx.bookingItem.createMany({
          data: pricedItems.map((item) => ({
            bookingId: booking.id,
            status: 'TECHNICIAN_SEARCHING',
            ...item,
          })),
        });

        // c. Initial status history entry
        await tx.bookingStatusHistory.create({
          data: {
            bookingId: booking.id,
            fromStatus: null,
            toStatus: 'TECHNICIAN_SEARCHING',
            changedBy: customerId,
            changedByType: 'CUSTOMER',
            reason: 'Booking created',
            metadata: {
              bookingNumber,
              itemCount: pricedItems.length,
            },
          },
        });

        // d. Convert cart: delete items + mark cart as CONVERTED
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        await tx.cart.update({
          where: { id: cart.id },
          data: { status: 'CONVERTED', lastActivityAt: new Date() },
        });

        return booking;
      });
    } catch (err: any) {
      this.logger.error(`[createBooking] Transaction failed for customer=${customerId}`, err?.stack);

      // Prisma unique constraint violation → idempotency race condition
      if (err?.code === 'P2002') {
        const retryExisting = await this.prisma.booking.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
          include: { items: true },
        });
        if (retryExisting) {
          return { alreadyCreated: true, ...formatBookingResponse(retryExisting) };
        }
      }

      throw new InternalServerErrorException({
        message: 'Your booking could not be created. Please try again.',
        errorCode: 'BOOKING_CREATION_FAILED',
      });
    }

    // Re-fetch with items relation included
    const fullBooking = await this.prisma.booking.findUnique({
      where: { id: newBooking.id },
      include: { items: true },
    });

    this.logger.log(`[createBooking] SUCCESS. booking=${bookingNumber} customer=${customerId}`);

    const formatted = formatBookingResponse(fullBooking);

    // Emit real-time event after DB transaction successfully commits
    this.realtimeService.emitBookingEvent(newBooking.id, REALTIME_EVENTS.BOOKING.CREATED, {
      bookingId: newBooking.id,
      bookingNumber: newBooking.bookingNumber,
      customerId: newBooking.customerId,
      status: newBooking.status,
      totalAmount: newBooking.totalAmount,
      serviceAddress: {
        label: newBooking.snapshotLabel,
        completeAddress: newBooking.snapshotAddress,
        city: newBooking.snapshotCity,
        latitude: newBooking.serviceLatitude,
        longitude: newBooking.serviceLongitude,
      },
      updatedAt: newBooking.updatedAt.toISOString(),
    });

    // Fire and forget dispatch engine
    this.dispatchService.dispatchBooking(newBooking.id).catch((err) => {
      this.logger.error(`[createBooking] Dispatch engine failed for booking=${newBooking.id}`, err?.stack);
    });

    return formatted;
  }

  // ─── List Bookings ──────────────────────────────────────────────────────────

  async getBookings(
    customerId: string,
    filter?: {
      status?: BookingStatus;
      tab?: 'upcoming' | 'completed';
    },
  ) {
    const where: any = { customerId };

    if (filter?.status) {
      where.status = filter.status;
    } else if (filter?.tab === 'upcoming') {
      where.status = {
        in: [
          'PENDING_MATCHING',
          'TECHNICIAN_SEARCHING',
          'PARTIALLY_ASSIGNED',
          'TECHNICIAN_ASSIGNED',
          'TECHNICIAN_ACCEPTED',
          'TECHNICIAN_ON_THE_WAY',
          'TECHNICIAN_ARRIVED',
          'SERVICE_STARTED',
          'SERVICE_COMPLETED',
          'PAYMENT_PENDING',
        ] as BookingStatus[],
      };
    } else if (filter?.tab === 'completed') {
      where.status = {
        in: ['COMPLETED', 'CANCELLED', 'FAILED'] as BookingStatus[],
      };
    }

    const bookings = await this.prisma.booking.findMany({
      where,
      include: {
        items: { include: { technician: true } },
        technician: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return bookings.map(formatBookingResponse);
  }

  // ─── Get Booking By ID ──────────────────────────────────────────────────────

  async getBookingById(customerId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        items: { include: { technician: true } },
        technician: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!booking) {
      throw new NotFoundException({
        message: 'Booking not found.',
        errorCode: 'BOOKING_NOT_FOUND',
      });
    }

    if (booking.customerId !== customerId) {
      throw new ForbiddenException({
        message: 'You do not have access to this booking.',
        errorCode: 'BOOKING_ACCESS_DENIED',
      });
    }

    return {
      ...formatBookingResponse(booking),
      statusHistory: booking.statusHistory.map((h: any) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        reason: h.reason,
        createdAt: h.createdAt,
      })),
    };
  }

  // ─── Cancel Booking ─────────────────────────────────────────────────────────

  async cancelBooking(customerId: string, bookingId: string, dto?: CancelBookingDto) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { items: true },
    });

    if (!booking) {
      throw new NotFoundException({
        message: 'Booking not found.',
        errorCode: 'BOOKING_NOT_FOUND',
      });
    }

    if (booking.customerId !== customerId) {
      throw new ForbiddenException({
        message: 'You do not have access to this booking.',
        errorCode: 'BOOKING_ACCESS_DENIED',
      });
    }

    if (!CANCELLABLE_STATUSES.includes(booking.status)) {
      throw new ConflictException({
        message: `Booking cannot be cancelled in status: ${booking.status}.`,
        errorCode: 'BOOKING_CANNOT_CANCEL',
      });
    }

    const previousStatus = booking.status;

    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: dto?.reason ?? 'Cancelled by customer',
        },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId,
          fromStatus: previousStatus,
          toStatus: 'CANCELLED',
          changedBy: customerId,
          changedByType: 'CUSTOMER',
          reason: dto?.reason ?? 'Cancelled by customer',
        },
      });
    });

    this.logger.log(`[cancelBooking] booking=${booking.bookingNumber} cancelled by customer=${customerId}`);

    const updated = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { items: true },
    });

    const formatted = formatBookingResponse(updated);

    // Emit real-time cancellation event after DB transaction commits
    this.realtimeService.emitBookingEvent(bookingId, REALTIME_EVENTS.BOOKING.CANCELLED, {
      bookingId,
      bookingNumber: booking.bookingNumber,
      customerId: booking.customerId,
      technicianId: booking.technicianId,
      status: 'CANCELLED',
      previousStatus,
      updatedAt: new Date().toISOString(),
    });

    return formatted;
  }

  // ─── Technician Booking View ─────────────────────────────────────────────────
  // Used by the notification-tap flow: technician reads bookingId from FCM payload
  // and fetches current authoritative state. Authorized by BookingDispatch record.

  async getBookingForTechnician(userId: string, bookingId: string) {
    // 1. Resolve technician profile from JWT userId
    const technician = await this.prisma.technicianProfile.findUnique({
      where: { userId },
    });

    if (!technician) {
      throw new ForbiddenException({
        message: 'Technician profile not found.',
        errorCode: 'TECHNICIAN_NOT_FOUND',
      });
    }

    // 2. Load the booking with all required relations
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        items: {
          include: {
            technician: true,
            dispatches: {
              where: { technicianId: technician.id },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
        technician: true,
      },
    });

    if (!booking) {
      throw new NotFoundException({
        message: 'Booking not found.',
        errorCode: 'BOOKING_NOT_FOUND',
      });
    }

    // 3. Authorization: technician must have at least one BookingDispatch for this booking
    const dispatch = await this.prisma.bookingDispatch.findFirst({
      where: {
        bookingId,
        technicianId: technician.id,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!dispatch) {
      throw new ForbiddenException({
        message: 'You are not authorized to view this booking.',
        errorCode: 'BOOKING_ACCESS_DENIED',
      });
    }

    // 4. Return technician-safe booking view
    // Include dispatch status so the frontend knows whether acceptance is still possible
    const formatted = formatBookingResponse(booking);

    return {
      ...formatted,
      // Technician-specific dispatch context
      dispatchStatus: dispatch.status,
      dispatchExpiresAt: dispatch.expiresAt,
      dispatchId: dispatch.id,
      // Normalised fields consumed by IncomingBookingModal
      serviceSummary: booking.items[0]?.serviceTitleSnapshot ?? 'Service Request',
      totalAmount: booking.totalAmount,
      distanceKm: dispatch.distanceKm,
      customerArea: booking.snapshotCity ?? 'Nearby',
      bookingItemId: booking.items.find(
        (i) => i.dispatches?.[0]?.technicianId === technician.id
      )?.id ?? booking.items[0]?.id ?? null,
    };
  }
}
