import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { REALTIME_EVENTS } from '../../realtime/constants/realtime-events.constant';
import { CreateReviewDto } from './dto/create-review.dto';
import { STORAGE_PROVIDER, StorageProvider } from '../../infrastructure/storage/storage.provider';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
    @Inject(STORAGE_PROVIDER) private readonly storageProvider: StorageProvider,
  ) {}

  /**
   * Compulsory Review Submission for a Booking.
   * Atomic Transaction:
   * 1. Saves review record.
   * 2. Recalculates aggregate technician rating.
   * 3. Generates 4-digit Happy Code.
   * 4. Emits real-time socket events to Customer, Technician, and Booking room.
   */
  async submitReview(customerId: string, bookingId: string, dto: CreateReviewDto) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        technician: {
          include: {
            user: true,
          },
        },
        items: true,
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.customerId !== customerId) {
      throw new ForbiddenException('You are not authorized to review this booking');
    }

    if (!booking.technicianId || !booking.technician) {
      throw new BadRequestException('Cannot submit a review for a booking without an assigned technician');
    }

    // Validation: Minimum text length rule
    const trimmedComment = dto.comment ? dto.comment.trim() : '';
    const isSuggestionUsed = Boolean(dto.suggestion && dto.suggestion.trim() !== '');

    if (!isSuggestionUsed && trimmedComment.length < 10) {
      throw new BadRequestException('Review comment must be at least 10 characters long unless a pre-built suggestion is selected');
    }

    // Check if review already submitted
    const existingReview = await this.prisma.review.findUnique({
      where: { bookingId },
    });

    if (existingReview) {
      if (booking.happyCode) {
        return {
          success: true,
          message: 'Review already submitted',
          happyCode: booking.happyCode,
          reviewId: existingReview.id,
        };
      }
      throw new ConflictException('A review has already been submitted for this booking');
    }

    const technicianId = booking.technicianId;
    const serviceId = booking.items?.[0]?.serviceId || null;

    // Execute atomic transaction
    const { review, happyCode } = await this.prisma.$transaction(async (tx) => {
      // 1. Create Review (linked to booking, customer, technician, and service)
      const newReview = await tx.review.create({
        data: {
          bookingId,
          customerId,
          technicianId,
          serviceId,
          rating: dto.rating,
          comment: trimmedComment,
          suggestion: dto.suggestion?.trim() || null,
        },
      });

      // 2. Recalculate Technician aggregate rating & total ratings
      const allTechReviews = await tx.review.findMany({
        where: { technicianId },
        select: { rating: true },
      });

      const totalTechRatingsCount = allTechReviews.length;
      const totalTechRatingSum = allTechReviews.reduce((sum, r) => sum + r.rating, 0);
      const avgTechRating = totalTechRatingsCount > 0 ? Number((totalTechRatingSum / totalTechRatingsCount).toFixed(1)) : 5.0;

      await tx.technicianProfile.update({
        where: { id: technicianId },
        data: {
          rating: avgTechRating,
          totalRatings: totalTechRatingsCount,
        },
      });

      // 3. Recalculate Service aggregate rating & review count (if serviceId present)
      if (serviceId) {
        const allServiceReviews = await tx.review.findMany({
          where: { serviceId },
          select: { rating: true },
        });

        const totalServiceCount = allServiceReviews.length;
        const totalServiceSum = allServiceReviews.reduce((sum, r) => sum + r.rating, 0);
        const avgServiceRating = totalServiceCount > 0 ? Number((totalServiceSum / totalServiceCount).toFixed(1)) : 5.0;

        await tx.service.update({
          where: { id: serviceId },
          data: {
            rating: avgServiceRating,
            reviewCount: totalServiceCount,
          },
        });
      }

      // 4. Generate Happy Code (if not already set)
      let generatedCode = booking.happyCode;
      if (!generatedCode) {
        generatedCode = crypto.randomInt(1000, 10000).toString();
        await tx.booking.update({
          where: { id: bookingId },
          data: { happyCode: generatedCode },
        });
      }

      return { review: newReview, happyCode: generatedCode };
    });

    this.logger.log(`Review submitted for booking ${bookingId}: rating=${dto.rating}, happyCode=${happyCode}`);

    // Prepare signed photo if available
    let signedPhoto = booking.technician.profilePhoto || null;
    if (signedPhoto) {
      try {
        signedPhoto = await this.storageProvider.getSignedUrl(signedPhoto);
      } catch {
        // preserve existing
      }
    }

    const techName = booking.technician.fullName || booking.technician.user?.name || 'Your Technician';

    // 4. Emit Real-time Socket Events
    const realTimePayload = {
      bookingId,
      bookingNumber: booking.bookingNumber,
      customerId,
      technicianId,
      status: booking.status,
      happyCode,
      reviewRequested: false,
      review: {
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        suggestion: review.suggestion,
      },
      technician: {
        id: technicianId,
        fullName: techName,
        profilePhoto: signedPhoto,
      },
      engineer: {
        id: technicianId,
        name: techName,
        photo: signedPhoto,
        profilePhoto: signedPhoto,
        phone: (booking.technician as any).contact || booking.technician.user?.phone || null,
        rating: String(dto.rating),
        completedJobs: booking.technician.totalRatings + 1,
        distance: '2.5 km',
        isTopRated: true,
      },
      updatedAt: new Date().toISOString(),
    };

    // Emit review submitted event (contains review details and happyCode)
    this.realtimeService.emitBookingEvent(bookingId, REALTIME_EVENTS.BOOKING.REVIEW_SUBMITTED, realTimePayload);

    return {
      success: true,
      message: 'Review submitted successfully. Happy Code generated.',
      happyCode,
      reviewId: review.id,
      review: {
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        suggestion: review.suggestion,
      },
    };
  }

  /**
   * Get review details / status for a specific booking.
   */
  async getReviewStatus(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        review: true,
        technician: true,
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.customerId !== userId && booking.technicianId !== userId && (booking.technician as any)?.userId !== userId) {
      throw new ForbiddenException('You do not have access to this booking');
    }

    const isReviewSubmitted = Boolean(booking.review);
    const isReviewPending = booking.status === 'SERVICE_STARTED' && !isReviewSubmitted;

    return {
      bookingId,
      bookingStatus: booking.status,
      isReviewPending,
      isReviewSubmitted,
      happyCode: booking.happyCode || null,
      review: booking.review || null,
    };
  }

  /**
   * Get all reviews submitted for a specific technician profile.
   */
  async getTechnicianReviews(technicianId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { technicianId },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
        booking: {
          select: {
            bookingNumber: true,
            completedAt: true,
            items: {
              select: {
                serviceTitleSnapshot: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      suggestion: r.suggestion,
      createdAt: r.createdAt,
      customerName: r.customer?.name || 'Customer',
      serviceName: r.booking?.items[0]?.serviceTitleSnapshot || 'Service',
      bookingNumber: r.booking?.bookingNumber,
    }));
  }

  /**
   * Get all public reviews submitted for a specific service with fast pagination.
   */
  async getServiceReviews(serviceId: string, page = 1, limit = 10) {
    const pageNum = Math.max(1, page);
    const limitNum = Math.min(50, Math.max(1, limit));
    const skip = (pageNum - 1) * limitNum;

    const whereCondition = {
      OR: [
        { serviceId },
        { booking: { items: { some: { serviceId } } } },
      ],
    };

    const [reviews, totalCount] = await Promise.all([
      this.prisma.review.findMany({
        where: whereCondition,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
          technician: {
            select: {
              id: true,
              fullName: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limitNum,
      }),
      this.prisma.review.count({
        where: whereCondition,
      }),
    ]);

    const formatted = reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      suggestion: r.suggestion,
      createdAt: r.createdAt,
      user: {
        id: r.customer?.id || '',
        fullName: r.customer?.name || 'Mubryx Customer',
      },
      technicianName: r.technician?.fullName || 'Technician',
    }));

    return {
      reviews: formatted,
      total: totalCount,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalCount / limitNum),
      hasMore: pageNum * limitNum < totalCount,
    };
  }
}
