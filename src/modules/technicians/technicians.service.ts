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
    let profile = await this.prisma.technicianProfile.findUnique({
      where: { userId },
      include: {
        documents: true,
        experiences: true,
        skills: true,
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
        },
        include: {
          documents: true,
          experiences: true,
          skills: true,
        },
      });
    }

    return profile;
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

    const docTypes = profile.documents.map((d) => d.type);
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

    const dispatches = await this.prisma.bookingDispatch.findMany({
      where: {
        technicianId: profile.id,
        status: 'OFFERED',
        expiresAt: { gt: new Date() },
        booking: { status: 'TECHNICIAN_SEARCHING' }
      },
      include: {
        booking: {
          include: {
            customer: {
              select: { name: true, phone: true }
            },
            items: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return dispatches;
  }

  async getNotifications(userId: string) {
    // 1. Proactively auto-clean stale incoming booking notifications
    const allNotifications = await this.prisma.notification.findMany({
      where: { recipientId: userId },
      orderBy: { createdAt: 'desc' }
    });

    const incomingBookingNotifs = allNotifications.filter(n => n.type === 'booking:incoming' && n.bookingId);
    
    if (incomingBookingNotifs.length > 0) {
      const bookingIds = incomingBookingNotifs.map(n => n.bookingId as string);
      
      // Fetch the current status of these bookings
      const bookings = await this.prisma.booking.findMany({
        where: {
          id: { in: bookingIds }
        },
        select: { id: true, status: true }
      });

      const activeBookingIds = new Set(
        bookings
          .filter(b => b.status === 'TECHNICIAN_SEARCHING' || b.status === 'PENDING_MATCHING')
          .map(b => b.id)
      );

      // Identify stale notifications
      const staleNotifIds = incomingBookingNotifs
        .filter(n => !activeBookingIds.has(n.bookingId as string))
        .map(n => n.id);

      if (staleNotifIds.length > 0) {
        // Delete them from DB
        await this.prisma.notification.deleteMany({
          where: { id: { in: staleNotifIds } }
        });

        // Filter them out of the return array
        return allNotifications.filter(n => !staleNotifIds.includes(n.id));
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
}
