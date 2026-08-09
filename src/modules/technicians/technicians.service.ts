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
    const profile = await this.prisma.technicianProfile.findUnique({
      where: { userId },
      include: {
        documents: true,
        experiences: true,
        skills: true,
      },
    });

    if (!profile) {
      throw new BadRequestException('Technician profile not found');
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
}
