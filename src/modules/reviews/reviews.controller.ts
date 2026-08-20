import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

import { Public } from '../../common/decorators/public.decorator';

function getUserIdFromUser(user: any): string {
  const userId = user?.userId || user?.sub || user?.id;
  if (!userId) {
    throw new UnauthorizedException('Invalid or missing user context in token');
  }
  return userId;
}

@ApiTags('Reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  /**
   * POST /bookings/:id/review
   * Submit compulsory review for a booking.
   * Generates Happy Code upon successful submission.
   */
  @Post('bookings/:id/review')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit compulsory review for booking to unlock Happy Code' })
  async submitReview(
    @CurrentUser() user: any,
    @Param('id') bookingId: string,
    @Body() dto: CreateReviewDto,
  ) {
    const customerId = getUserIdFromUser(user);
    return this.reviewsService.submitReview(customerId, bookingId, dto);
  }

  /**
   * GET /bookings/:id/review-status
   * Get review status & pending review check for a booking.
   */
  @Get('bookings/:id/review-status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get review status for a booking' })
  async getReviewStatus(
    @CurrentUser() user: any,
    @Param('id') bookingId: string,
  ) {
    const userId = getUserIdFromUser(user);
    return this.reviewsService.getReviewStatus(userId, bookingId);
  }

  /**
   * GET /technicians/:technicianId/reviews
   * Get reviews submitted for a specific technician.
   */
  @Public()
  @Get('technicians/:technicianId/reviews')
  @ApiOperation({ summary: 'Get public reviews for a technician' })
  async getTechnicianReviews(
    @Param('technicianId') technicianId: string,
  ) {
    return this.reviewsService.getTechnicianReviews(technicianId);
  }

  /**
   * GET /services/:serviceId/reviews
   * Get public customer reviews submitted for a specific service.
   */
  @Public()
  @Get('services/:serviceId/reviews')
  @ApiOperation({ summary: 'Get public customer reviews for a specific service' })
  async getServiceReviews(
    @Param('serviceId') serviceId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.reviewsService.getServiceReviews(serviceId, pageNum, limitNum);
  }
}
