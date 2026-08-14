import {
  Injectable,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OtpService } from '../auth/services/otp.service';
import { TokenService } from '../auth/services/token.service';
import { normalizeIndianPhoneNumber } from '../../common/utils/phone.util';
import { STORAGE_PROVIDER, StorageProvider } from '../../infrastructure/storage/storage.provider';
import { DocumentType, OnboardingStatus } from '../../generated/prisma/client';
import {
  TechnicianVerifyOtpDto,
} from './dto/auth.dto';
import {
  UpdateBasicInfoDto,
  UpdateSkillsDto,
  UpdateExperienceDto,
} from './dto/onboarding.dto';

@Injectable()
export class TechniciansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
    @Inject(STORAGE_PROVIDER) private readonly storageProvider: StorageProvider,
  ) {}

  async requestOtp(phone: string) {
    const normalizedPhone = normalizeIndianPhoneNumber(phone);
    if (!normalizedPhone) {
      throw new BadRequestException('Invalid Indian mobile number');
    }

    const result = await this.otpService.requestOtp(normalizedPhone);
    return {
      message: 'OTP sent successfully',
      phone: normalizedPhone,
      devOtp: result.devOtp,
      expiresIn: 300,
      resendAvailableIn: 30,
    };
  }

  async verifyOtp(dto: TechnicianVerifyOtpDto) {
    const normalizedPhone = normalizeIndianPhoneNumber(dto.phone);
    if (!normalizedPhone) {
      throw new BadRequestException('Invalid Indian mobile number');
    }

    await this.otpService.verifyOtp(normalizedPhone, dto.code);

    let user = await this.prisma.user.findUnique({
      where: { phone: normalizedPhone },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone: normalizedPhone,
          name: dto.fullName || null,
          role: 'TECHNICIAN',
        },
      });
    } else if (user.role !== 'TECHNICIAN') {
      // Upgrade role to TECHNICIAN if missing
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { role: 'TECHNICIAN' },
      });
    }

    let profile = await this.prisma.technicianProfile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      profile = await this.prisma.technicianProfile.create({
        data: {
          userId: user.id,
          fullName: user.name,
        },
      });
    }

    const tokens = await this.tokenService.generateTokens(user);

    return {
      user: {
        id: user.id,
        fullName: user.name,
        phone: user.phone,
        role: user.role,
        isPhoneVerified: true,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      onboardingStatus: profile.onboardingStatus,
    };
  }

  async getProfile(userId: string) {
    let profile: any = await this.prisma.technicianProfile.findUnique({
      where: { userId },
      include: {
        documents: true,
        experiences: true,
        skills: true,
        bankDetails: true,
        wallet: true,
        user: { select: { phone: true, email: true, createdAt: true } },
      },
    });

    if (!profile) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new BadRequestException('User not found');
      }

      profile = await this.prisma.technicianProfile.create({
        data: {
          userId: user.id,
          fullName: user.name,
          onboardingStatus: 'DRAFT',
          wallet: {
            create: {
              availableBalance: 0,
            }
          }
        },
        include: {
          documents: true,
          experiences: true,
          skills: true,
          bankDetails: true,
          wallet: true,
          user: { select: { phone: true, email: true, createdAt: true } },
        },
      });
    }


    let signedProfilePhoto = profile.profilePhoto;
    if (signedProfilePhoto) {
      try {
        signedProfilePhoto = await this.storageProvider.getSignedUrl(signedProfilePhoto);
      } catch (err) {
        // Fallback to original url if signing fails
      }
    }

    // Use optimized aggregate queries rather than in-memory calculation
    const performance = await this.getPerformance(userId);

    // Fetch Wallet
    const wallet = await this.prisma.technicianWallet.findUnique({
      where: { technicianId: profile.id },
    });

    // Fetch Active Jobs and determine highest priority
    const activeJobs = await this.prisma.booking.findMany({
      where: {
        technicianId: profile.id,
        status: { in: ['TECHNICIAN_ACCEPTED', 'TECHNICIAN_ON_THE_WAY', 'TECHNICIAN_ARRIVED', 'SERVICE_STARTED'] },
      },
      include: {
        customer: { select: { name: true, phone: true } },
        address: true,
        items: { include: { service: true } },
      }
    });

    const statusPriority: Record<string, number> = {
      'SERVICE_STARTED': 4,
      'TECHNICIAN_ARRIVED': 3,
      'TECHNICIAN_ON_THE_WAY': 2,
      'TECHNICIAN_ACCEPTED': 1,
    };

    activeJobs.sort((a, b) => {
      const diff = (statusPriority[b.status] || 0) - (statusPriority[a.status] || 0);
      if (diff !== 0) return diff;
      return new Date(a.scheduledAt || 0).getTime() - new Date(b.scheduledAt || 0).getTime();
    });

    const activeJob = activeJobs[0] || null;

    // Fetch Upcoming Jobs (Jobs assigned but not yet started/active)
    const upcomingJobs = await this.prisma.booking.findMany({
      where: {
        technicianId: profile.id,
        status: { in: ['TECHNICIAN_ASSIGNED', 'TECHNICIAN_ACCEPTED'] },
        id: { not: activeJob?.id || undefined },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
      include: {
        customer: { select: { name: true, phone: true } },
        address: true,
        items: { include: { service: true } },
      }
    });

    const unreadNotifications = await this.prisma.notification.count({
      where: { recipientId: userId, isRead: false },
    });

    return {
      ...profile,
      profilePhoto: signedProfilePhoto,
      phone: profile.user?.phone,
      email: profile.user?.email,
      joinedDate: profile.user?.createdAt,
      performance,
      // Flatten performance metrics for backward compatibility with frontend
      assignedJobs: performance.jobsCompleted, // Map to semantic usage on frontend
      completedJobs: performance.jobsCompleted,
      pendingJobs: upcomingJobs.length,
      earnings: performance.totalEarnings,
      averageRating: performance.averageRating,
      acceptanceRate: performance.acceptanceRate,
      activeJob,
      upcomingJobs,
      wallet,
      unreadNotifications,
    };
  }

  async getPerformance(userId: string) {
    // Resolve technician profile ID from userId (JWT subject)
    const profile = await this.prisma.technicianProfile.findUnique({
      where: { userId },
      select: { id: true, rating: true, totalRatings: true },
    });

    if (!profile) {
      throw new BadRequestException('Technician profile not found');
    }

    const technicianId = profile.id;
    const now = new Date();

    // ── Period boundaries ─────────────────────────────────────────────────────
    const last30DaysStart = new Date(now);
    last30DaysStart.setDate(last30DaysStart.getDate() - 30);

    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // ── Jobs Completed (All Time) ─────────────────────────────────────────────
    // Only count bookings genuinely COMPLETED by this specific technician
    const jobsCompleted = await this.prisma.booking.count({
      where: {
        technicianId,
        status: { in: ['COMPLETED', 'SERVICE_COMPLETED'] },
      },
    });

    // ── This Month Jobs (completed within current calendar month) ─────────────
    const thisMonthJobs = await this.prisma.booking.count({
      where: {
        technicianId,
        status: { in: ['COMPLETED', 'SERVICE_COMPLETED'] },
        completedAt: { gte: thisMonthStart },
      },
    });

    // ── Total Earnings (All Time, from completed bookings) ────────────────────
    const earningsResult = await this.prisma.walletTransaction.aggregate({
      where: {
        wallet: { technicianId },
        type: 'JOB_EARNING',
      },
      _sum: { amount: true },
    });
    const totalEarnings = earningsResult._sum.amount ?? 0;

    // ── Acceptance Rate (Last 30 days) ────────────────────────────────────────
    // Denominator: dispatches with terminal outcomes that the technician was
    // responsible for: ACCEPTED, REJECTED, EXPIRED.
    // SUPERSEDED means another tech accepted first — not the technician's fault,
    // so we exclude SUPERSEDED from the denominator.
    const [acceptedDispatches, rejectedDispatches, expiredDispatches] = await Promise.all([
      this.prisma.bookingDispatch.count({
        where: {
          technicianId,
          status: 'ACCEPTED',
          createdAt: { gte: last30DaysStart },
        },
      }),
      this.prisma.bookingDispatch.count({
        where: {
          technicianId,
          status: 'REJECTED',
          createdAt: { gte: last30DaysStart },
        },
      }),
      this.prisma.bookingDispatch.count({
        where: {
          technicianId,
          status: 'EXPIRED',
          createdAt: { gte: last30DaysStart },
        },
      }),
    ]);

    const totalEligibleDispatches = acceptedDispatches + rejectedDispatches + expiredDispatches;
    const acceptanceRate =
      totalEligibleDispatches > 0
        ? Math.round((acceptedDispatches / totalEligibleDispatches) * 100)
        : 0; // 0 = no data, not 100

    // ── Completion Rate (Last 30 days) ────────────────────────────────────────
    // Denominator: bookings assigned to this technician that reached a terminal
    // status (COMPLETED, CANCELLED, FAILED) within last 30 days.
    // Only count jobs that were genuinely this technician's responsibility
    // (technicianId matches and the booking had a terminal outcome).
    const [completedCount, cancelledCount, failedCount] = await Promise.all([
      this.prisma.booking.count({
        where: {
          technicianId,
          status: { in: ['COMPLETED', 'SERVICE_COMPLETED'] },
          assignedAt: { gte: last30DaysStart },
        },
      }),
      this.prisma.booking.count({
        where: {
          technicianId,
          status: 'CANCELLED',
          assignedAt: { gte: last30DaysStart },
        },
      }),
      this.prisma.booking.count({
        where: {
          technicianId,
          status: 'FAILED',
          assignedAt: { gte: last30DaysStart },
        },
      }),
    ]);

    const totalTerminalBookings = completedCount + cancelledCount + failedCount;
    const completionRate =
      totalTerminalBookings > 0
        ? Math.round((completedCount / totalTerminalBookings) * 100)
        : 0; // 0 = no data, not 100

    // ── Average Rating ────────────────────────────────────────────────────────
    // Use the authoritative denormalized fields on the profile.
    // When totalRatings = 0, averageRating is 0 (not 5.0).
    // Note: rating field defaults to 0.0 in schema, totalRatings defaults to 0.
    const averageRating = profile.totalRatings > 0 ? (profile.rating ?? 0) : 0;
    const ratingCount = profile.totalRatings ?? 0;

    return {
      jobsCompleted,
      thisMonthJobs,
      totalEarnings,
      acceptanceRate,
      completionRate,
      averageRating,
      ratingCount,
      period: {
        acceptanceRatePeriod: 'last_30_days',
        completionRatePeriod: 'last_30_days',
        jobsCompletedPeriod: 'all_time',
        periodStart: last30DaysStart.toISOString(),
        periodEnd: now.toISOString(),
      },
    };
  }

  async updateBasicInfo(userId: string, dto: UpdateBasicInfoDto) {
    const profile = await this.prisma.technicianProfile.findUnique({ where: { userId } });
    if (!profile) throw new BadRequestException('Technician profile not found');

    if (dto.fullName) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { name: dto.fullName },
      });
    }

    return this.prisma.technicianProfile.update({
      where: { userId },
      data: dto,
      include: {
        documents: true,
        experiences: true,
        skills: true,
      },
    });
  }

  async uploadDocument(
    userId: string,
    documentType: DocumentType,
    fileData: { buffer: Buffer; filename: string; mimetype: string },
  ) {
    const profile = await this.prisma.technicianProfile.findUnique({ where: { userId } });
    if (!profile) throw new BadRequestException('Technician profile not found');

    if (!documentType) throw new BadRequestException('documentType is required');
    if (!fileData || !fileData.buffer) throw new BadRequestException('File payload is missing');

    const ext = fileData.filename.split('.').pop() || 'png';
    const objectKey = `technicians/${profile.id}/documents/${documentType}_${Date.now()}.${ext}`;

    const uploadedUrl = await this.storageProvider.upload({
      key: objectKey,
      buffer: fileData.buffer,
      mimeType: fileData.mimetype,
      isPrivate: true,
    });

    try {
      const existingDoc = await this.prisma.technicianDocument.findFirst({
        where: { technicianId: profile.id, type: documentType },
      });

      if (existingDoc) {
        await this.storageProvider.delete(existingDoc.objectKey).catch(() => null);
        await this.prisma.technicianDocument.delete({ where: { id: existingDoc.id } });
      }

      const newDoc = await this.prisma.technicianDocument.create({
        data: {
          technicianId: profile.id,
          type: documentType,
          objectKey,
          mimeType: fileData.mimetype,
          fileSize: fileData.buffer.length,
        },
      });

      return {
        ...newDoc,
        url: uploadedUrl,
      };
    } catch (err) {
      await this.storageProvider.delete(objectKey).catch(() => null);
      throw err;
    }
  }

  async uploadProfilePhoto(
    userId: string,
    fileData: { buffer: Buffer; filename: string; mimetype: string },
  ) {
    const profile = await this.prisma.technicianProfile.findUnique({ where: { userId } });
    if (!profile) throw new BadRequestException('Technician profile not found');

    if (!fileData || !fileData.buffer) throw new BadRequestException('File payload is missing');

    const ext = fileData.filename.split('.').pop() || 'png';
    const objectKey = `technicians/${profile.id}/photo_${Date.now()}.${ext}`;

    const uploadedUrl = await this.storageProvider.upload({
      key: objectKey,
      buffer: fileData.buffer,
      mimeType: fileData.mimetype,
    });

    try {
      if (profile.profilePhoto) {
        await this.storageProvider.delete(profile.profilePhoto).catch(() => null);
      }

      return await this.prisma.technicianProfile.update({
        where: { userId },
        data: { profilePhoto: uploadedUrl },
        include: {
          documents: true,
          experiences: true,
          skills: true,
        },
      });
    } catch (err) {
      await this.storageProvider.delete(objectKey).catch(() => null);
      throw err;
    }
  }

  async updateSkills(userId: string, dto: UpdateSkillsDto) {
    const profile = await this.prisma.technicianProfile.findUnique({ where: { userId } });
    if (!profile) throw new BadRequestException('Technician profile not found');

    return this.prisma.technicianProfile.update({
      where: { userId },
      data: {
        skills: {
          set: dto.categoryIds.map((id) => ({ id })),
        },
      },
      include: {
        documents: true,
        experiences: true,
        skills: true,
      },
    });
  }

  async updateExperience(userId: string, dto: UpdateExperienceDto) {
    const profile = await this.prisma.technicianProfile.findUnique({ where: { userId } });
    if (!profile) throw new BadRequestException('Technician profile not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.technicianExperience.deleteMany({
        where: { technicianId: profile.id },
      });

      if (dto.history && dto.history.length > 0) {
        await tx.technicianExperience.createMany({
          data: dto.history.map((h) => ({
            technicianId: profile.id,
            totalExperience: dto.totalExperience || 'Less than 1 Year',
            companyName: h.companyName,
            role: h.role,
            startDate: h.startDate,
            endDate: h.endDate,
            city: h.city || null,
            responsibilities: h.responsibilities || null,
          })),
        });
      } else {
        await tx.technicianExperience.create({
          data: {
            technicianId: profile.id,
            totalExperience: dto.totalExperience || 'Less than 1 Year',
            companyName: 'Independent / Fresher',
            role: 'Technician',
            startDate: 'N/A',
            endDate: 'N/A',
          },
        });
      }
    });

    return this.getProfile(userId);
  }

  async submitApplication(userId: string) {
    const profile = await this.getProfile(userId);
    if (!profile) throw new BadRequestException('Technician profile not found');

    if (!profile.fullName || !profile.dateOfBirth || !profile.currentCity) {
      throw new BadRequestException('Basic information is incomplete');
    }

    const docTypes = profile.documents.map((d: any) => d.type);
    if (!docTypes.includes('AADHAAR') || !docTypes.includes('PAN')) {
      throw new BadRequestException('Mandatory documents (AADHAAR, PAN) are missing');
    }

    if (!profile.profilePhoto) {
      throw new BadRequestException('Profile photo is missing');
    }

    if (!profile.skills || profile.skills.length === 0) {
      throw new BadRequestException('At least one skill must be selected');
    }

    return this.prisma.technicianProfile.update({
      where: { userId },
      data: {
        onboardingStatus: OnboardingStatus.SUBMITTED,
        submittedAt: new Date(),
      },
      include: {
        documents: true,
        experiences: true,
        skills: true,
      },
    });
  }

  async updateStatus(userId: string, isOnline: boolean) {
    const profile = await this.getProfile(userId);
    if (!profile) throw new BadRequestException('Technician profile not found');

    return this.prisma.technicianProfile.update({
      where: { userId },
      data: { isOnline },
    });
  }

  async updateLocation(userId: string, latitude: number, longitude: number) {
    const profile = await this.getProfile(userId);
    if (!profile) throw new BadRequestException('Technician profile not found');

    return this.prisma.technicianProfile.update({
      where: { userId },
      data: {
        latitude,
        longitude,
        lastLocationUpdatedAt: new Date(),
      },
    });
  }

  async getNearbyLeads(userId: string) {
    const profile = await this.getProfile(userId);
    if (!profile) throw new BadRequestException('Technician profile not found');

    const techSkills = profile.skills || [];
    const skillCategoryIds = techSkills.map((s: any) => s.id);

    // Dynamic Discovery: auto-discover open bookings in TECHNICIAN_SEARCHING matching technician skills & radius
    if (profile.latitude && profile.longitude) {
      const openBookings = await this.prisma.booking.findMany({
        where: {
          status: 'TECHNICIAN_SEARCHING',
          serviceLatitude: { not: null },
          serviceLongitude: { not: null },
          ...(skillCategoryIds.length > 0
            ? {
                items: {
                  some: {
                    service: {
                      categoryId: { in: skillCategoryIds },
                    },
                  },
                },
              }
            : {}),
        },
        include: {
          items: { include: { service: true } },
        },
      });

      const expiresAt = new Date(Date.now() + 60 * 1000);

      for (const booking of openBookings) {
        const R = 6371;
        const dLat = (booking.serviceLatitude! - profile.latitude) * (Math.PI / 180);
        const dLon = (booking.serviceLongitude! - profile.longitude) * (Math.PI / 180);
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(profile.latitude * (Math.PI / 180)) *
            Math.cos(booking.serviceLatitude! * (Math.PI / 180)) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        if (distance <= 30) {
          const matchingItems = booking.items.filter((item) => {
            const isUnassigned = item.status === 'PENDING_MATCHING' || item.status === 'TECHNICIAN_SEARCHING';
            const matchesSkill =
              skillCategoryIds.length === 0 ||
              (item.service?.categoryId && skillCategoryIds.includes(item.service.categoryId));
            return isUnassigned && matchesSkill;
          });

          for (const item of matchingItems) {
            await this.prisma.bookingDispatch.upsert({
              where: {
                bookingItemId_technicianId: {
                  bookingItemId: item.id,
                  technicianId: profile.id,
                },
              },
              update: {
                status: 'OFFERED',
                distanceKm: Number(distance.toFixed(1)),
                bookingId: booking.id,
              },
              create: {
                bookingId: booking.id,
                bookingItemId: item.id,
                technicianId: profile.id,
                distanceKm: Number(distance.toFixed(1)),
                status: 'OFFERED',
                expiresAt,
              },
            });
          }
        }
      }
    }

    const dispatches = await this.prisma.bookingDispatch.findMany({
      where: {
        technicianId: profile.id,
        status: 'OFFERED',
        booking: { status: 'TECHNICIAN_SEARCHING' },
      },
      include: {
        bookingItem: {
          include: {
            service: true,
          },
        },
        booking: {
          include: {
            customer: {
              select: { name: true, phone: true },
            },
            items: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return dispatches;
  }

  async getNotifications(userId: string) {
    // 1. Proactively auto-clean stale incoming booking notifications
    const allNotifications = await this.prisma.notification.findMany({
      where: { recipientId: userId },
      orderBy: { createdAt: 'desc' },
    });

    const incomingBookingNotifs = allNotifications.filter((n) => n.type === 'booking:incoming' && n.bookingId);

    if (incomingBookingNotifs.length > 0) {
      const itemIds = incomingBookingNotifs
        .map((n) => (n.metadata as any)?.bookingItemId)
        .filter(Boolean) as string[];

      const bookingIds = incomingBookingNotifs.map((n) => n.bookingId as string);

      const [bookings, bookingItems] = await Promise.all([
        this.prisma.booking.findMany({
          where: { id: { in: bookingIds } },
          select: { id: true, status: true },
        }),
        itemIds.length > 0
          ? this.prisma.bookingItem.findMany({
              where: { id: { in: itemIds } },
              select: { id: true, status: true },
            })
          : [],
      ]);

      const activeBookingIds = new Set(
        bookings
          .filter(
            (b) =>
              b.status === 'TECHNICIAN_SEARCHING' ||
              b.status === 'PENDING_MATCHING' ||
              b.status === 'PARTIALLY_ASSIGNED',
          )
          .map((b) => b.id),
      );

      const activeItemIds = new Set(
        bookingItems
          .filter((i) => i.status === 'TECHNICIAN_SEARCHING' || i.status === 'PENDING_MATCHING')
          .map((i) => i.id),
      );

      // Identify stale notifications
      const staleNotifIds = incomingBookingNotifs
        .filter((n) => {
          if (!activeBookingIds.has(n.bookingId as string)) return true;
          const itemId = (n.metadata as any)?.bookingItemId;
          if (itemId && !activeItemIds.has(itemId)) return true;
          return false;
        })
        .map((n) => n.id);

      if (staleNotifIds.length > 0) {
        // Delete them from DB
        await this.prisma.notification.deleteMany({
          where: { id: { in: staleNotifIds } },
        });

        // Filter them out of the return array
        return allNotifications.filter((n) => !staleNotifIds.includes(n.id));
      }
    }

    return allNotifications;
  }

  async markNotificationRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId }
    });
    
    if (!notification || notification.recipientId !== userId) {
      throw new BadRequestException('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true }
    });
  }

  async getEarnings(userId: string) {
    const profile = await this.prisma.technicianProfile.findUnique({
      where: { userId },
      include: { bankDetails: true }
    });

    if (!profile) throw new BadRequestException('Technician profile not found');

    const wallet = await this.prisma.technicianWallet.findUnique({
      where: { technicianId: profile.id }
    });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const transactions = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet?.id, type: 'JOB_EARNING' },
      orderBy: { createdAt: 'desc' }
    });

    let today = 0, thisWeek = 0, thisMonth = 0, lifetime = 0;
    
    const mappedTransactions = [];

    const bookingIds = transactions.filter(t => t.referenceId).map(t => t.referenceId as string);
    const bookings = await this.prisma.booking.findMany({
      where: { id: { in: bookingIds } },
      include: {
        customer: { select: { name: true } },
        items: { include: { service: { include: { Category: true } } } }
      }
    });

    const bookingMap = new Map(bookings.map(b => [b.id, b]));

    for (const tx of transactions) {
      const amount = tx.amount;
      lifetime += amount;
      if (tx.createdAt >= todayStart) today += amount;
      if (tx.createdAt >= weekStart) thisWeek += amount;
      if (tx.createdAt >= monthStart) thisMonth += amount;

      const booking = tx.referenceId ? bookingMap.get(tx.referenceId) : null;
      const serviceName = booking?.items[0]?.service?.title || tx.description || 'Service';
      const categoryName = booking?.items[0]?.service?.Category?.name || 'Category';

      mappedTransactions.push({
        id: tx.id,
        bookingId: tx.referenceId || tx.id,
        customerName: booking?.customer?.name || 'Customer',
        serviceName,
        applianceName: categoryName,
        amount: tx.amount,
        date: tx.createdAt.toISOString(),
        status: 'paid'
      });
    }

    const totalJobsResult = await this.prisma.booking.count({
      where: { technicianId: profile.id, status: { in: ['COMPLETED', 'SERVICE_COMPLETED'] } }
    });

    return {
      summary: {
        today,
        todayChange: 0,
        thisWeek,
        weekChange: 0,
        thisMonth,
        monthLabel: monthStart.toLocaleString('default', { month: 'long' }),
        lifetime,
        totalJobs: totalJobsResult
      },
      transactions: mappedTransactions,
      payoutInfo: {
        availableBalance: wallet?.availableBalance || 0,
        bank: profile.bankDetails ? {
          bankName: profile.bankDetails.bankName,
          maskedAccount: '•••• ' + profile.bankDetails.accountNumber.slice(-4),
          ifsc: profile.bankDetails.ifsc,
          isVerified: profile.bankDetails.isVerified
        } : null,
        upi: profile.bankDetails?.upiId ? {
          upiId: profile.bankDetails.upiId,
          isVerified: profile.bankDetails.upiVerified
        } : null
      },
      withdrawalHistory: []
    };
  }
}
