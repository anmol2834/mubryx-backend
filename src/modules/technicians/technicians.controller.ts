import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TechniciansService } from './technicians.service';
import { TechnicianRequestOtpDto, TechnicianVerifyOtpDto } from './dto/auth.dto';
import {
  UpdateBasicInfoDto,
  UpdateSkillsDto,
  UpdateExperienceDto,
  UpdateStatusDto,
  UpdateLocationDto,
} from './dto/onboarding.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DocumentType } from '../../generated/prisma/client';
import { FastifyRequest } from 'fastify';

function getUserIdFromUser(user: any): string {
  const userId = user?.userId || user?.sub || user?.id;
  if (!userId) {
    throw new BadRequestException('Invalid or missing user context in token');
  }
  return userId;
}

@ApiTags('Technicians')
@Controller('technicians')
export class TechniciansController {
  constructor(private readonly techniciansService: TechniciansService) {}

  @Post('auth/request-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request OTP for Technician Login/Signup' })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  async requestOtp(@Body() dto: TechnicianRequestOtpDto) {
    return this.techniciansService.requestOtp(dto.phone);
  }

  @Post('auth/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP and get Technician token' })
  @ApiResponse({ status: 200, description: 'OTP verified successfully' })
  async verifyOtp(@Body() dto: TechnicianVerifyOtpDto) {
    return this.techniciansService.verifyOtp(dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('dashboard/p0')
  @ApiOperation({ summary: 'Get P0 immediate technician dashboard data (Profile basic info, Active job, Today summary)' })
  async getP0Dashboard(@CurrentUser() user: any) {
    const userId = getUserIdFromUser(user);
    return this.techniciansService.getP0Dashboard(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('dashboard/p1')
  @ApiOperation({ summary: 'Get P1 non-blocking technician metrics (Earnings, Rating, Acceptance rate)' })
  async getP1Dashboard(@CurrentUser() user: any) {
    const userId = getUserIdFromUser(user);
    return this.techniciansService.getP1Dashboard(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('onboarding/profile')
  @ApiOperation({ summary: 'Get current technician profile and onboarding status' })
  async getProfile(@CurrentUser() user: any) {
    const userId = getUserIdFromUser(user);
    return this.techniciansService.getProfile(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('performance')
  @ApiOperation({ summary: 'Get authenticated technician performance metrics (backend-authoritative, no hardcoded values)' })
  async getPerformance(@CurrentUser() user: any) {
    const userId = getUserIdFromUser(user);
    return this.techniciansService.getPerformance(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('onboarding/basic-info')
  @ApiOperation({ summary: 'Update basic information' })
  async updateBasicInfo(@CurrentUser() user: any, @Body() dto: UpdateBasicInfoDto) {
    const userId = getUserIdFromUser(user);
    return this.techniciansService.updateBasicInfo(userId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('onboarding/documents')
  @ApiOperation({ summary: 'Upload a technician verification document directly' })
  async uploadDocument(@CurrentUser() user: any, @Req() req: FastifyRequest) {
    const userId = getUserIdFromUser(user);

    if (!req.isMultipart || !req.isMultipart()) {
      throw new BadRequestException('Request must be multipart/form-data');
    }

    const data = await req.file();
    if (!data) {
      throw new BadRequestException('No document file was uploaded');
    }

    const rawType = (data.fields as any)?.documentType;
    const documentType = (typeof rawType === 'object' ? rawType?.value : rawType) as DocumentType;

    if (!documentType) {
      throw new BadRequestException('documentType field is required');
    }

    const buffer = await data.toBuffer();
    return this.techniciansService.uploadDocument(userId, documentType, {
      buffer,
      filename: data.filename,
      mimetype: data.mimetype,
    });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('onboarding/profile-photo')
  @ApiOperation({ summary: 'Upload a technician profile photo directly' })
  async uploadProfilePhoto(@CurrentUser() user: any, @Req() req: FastifyRequest) {
    const userId = getUserIdFromUser(user);

    if (!req.isMultipart || !req.isMultipart()) {
      throw new BadRequestException('Request must be multipart/form-data');
    }

    const data = await req.file();
    if (!data) {
      throw new BadRequestException('No photo file was uploaded');
    }

    const buffer = await data.toBuffer();
    return this.techniciansService.uploadProfilePhoto(userId, {
      buffer,
      filename: data.filename,
      mimetype: data.mimetype,
    });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put('onboarding/skills')
  @ApiOperation({ summary: 'Update selected skills (services)' })
  async updateSkills(@CurrentUser() user: any, @Body() dto: UpdateSkillsDto) {
    const userId = getUserIdFromUser(user);
    return this.techniciansService.updateSkills(userId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put('onboarding/experience')
  @ApiOperation({ summary: 'Update work experience history' })
  async updateExperience(@CurrentUser() user: any, @Body() dto: UpdateExperienceDto) {
    const userId = getUserIdFromUser(user);
    return this.techniciansService.updateExperience(userId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('onboarding/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit application for review' })
  async submitApplication(@CurrentUser() user: any) {
    const userId = getUserIdFromUser(user);
    return this.techniciansService.submitApplication(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('status')
  @ApiOperation({ summary: 'Update technician online/offline status' })
  async updateStatus(@CurrentUser() user: any, @Body() dto: UpdateStatusDto) {
    const userId = getUserIdFromUser(user);
    return this.techniciansService.updateStatus(userId, dto.status === 'online');
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('location')
  @ApiOperation({ summary: 'Update technician GPS location' })
  async updateLocation(@CurrentUser() user: any, @Body() dto: UpdateLocationDto) {
    const userId = getUserIdFromUser(user);
    if (dto.latitude === undefined || dto.longitude === undefined) {
      throw new BadRequestException('Latitude and longitude are required');
    }
    return this.techniciansService.updateLocation(userId, dto.latitude, dto.longitude);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('nearby-leads')
  @ApiOperation({ summary: 'Get nearby incoming bookings for technician with cursor pagination & filtering' })
  async getNearbyLeads(
    @CurrentUser() user: any,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('sort') sort?: string,
    @Query('category') category?: string,
  ) {
    const userId = getUserIdFromUser(user);
    return this.techniciansService.getNearbyLeads(userId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
      sort,
      category,
    });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('notifications')
  @ApiOperation({ summary: 'Get notifications for technician' })
  async getNotifications(@CurrentUser() user: any) {
    const userId = getUserIdFromUser(user);
    return this.techniciansService.getNotifications(userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('notifications/:id/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  async markNotificationRead(@CurrentUser() user: any, @Req() req: FastifyRequest) {
    const userId = getUserIdFromUser(user);
    const notificationId = (req.params as any).id;
    return this.techniciansService.markNotificationRead(userId, notificationId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('earnings')
  @ApiOperation({ summary: 'Get detailed earnings and transaction ledger' })
  async getEarnings(@CurrentUser() user: any) {
    const userId = getUserIdFromUser(user);
    return this.techniciansService.getEarnings(userId);
  }
}
