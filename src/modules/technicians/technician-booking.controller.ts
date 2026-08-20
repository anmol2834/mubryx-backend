import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TechnicianBookingService } from './technician-booking.service';
import { BookingStatus } from '../../generated/prisma/client';

function getUserIdFromUser(user: any): string {
  const userId = user?.userId || user?.sub || user?.id;
  if (!userId) {
    throw new BadRequestException('Invalid or missing user context in token');
  }
  return userId;
}

@ApiTags('Technician Bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('technicians/bookings')
export class TechnicianBookingController {
  constructor(private readonly technicianBookingService: TechnicianBookingService) {}

  @Get()
  @ApiOperation({ summary: 'List technician active and completed bookings' })
  async getBookings(
    @CurrentUser() user: any,
    @Query('tab') tab?: 'active' | 'completed',
  ) {
    const userId = getUserIdFromUser(user);
    return this.technicianBookingService.getTechnicianBookings(userId, tab);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a specific booking assigned to technician' })
  async getBookingById(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    const userId = getUserIdFromUser(user);
    return this.technicianBookingService.getTechnicianBookingById(userId, id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update booking status' })
  async updateBookingStatus(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('status') status: BookingStatus,
    @Body('otp') otp?: string,
  ) {
    const userId = getUserIdFromUser(user);
    if (!status) {
      throw new BadRequestException('Status is required');
    }
    return this.technicianBookingService.updateBookingStatus(userId, id, status, otp);
  }

  @Post(':id/request-review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request customer review when technician clicks End Service' })
  async requestReview(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    const userId = getUserIdFromUser(user);
    return this.technicianBookingService.requestReview(userId, id);
  }

  @Post(':id/generate-happy-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate Happy Code for booking completion' })
  async generateHappyCode(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    const userId = getUserIdFromUser(user);
    return this.technicianBookingService.generateHappyCode(userId, id);
  }

  @Post(':id/spare-parts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a spare part to the booking' })
  async addSparePart(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() item: { name: string; category?: string; unitPrice: number; quantity: number },
  ) {
    const userId = getUserIdFromUser(user);
    if (!item.name || item.unitPrice === undefined || !item.quantity) {
      throw new BadRequestException('Invalid spare part data');
    }
    return this.technicianBookingService.addSparePart(userId, id, item);
  }

  @Patch(':id/spare-parts/:partId')
  @ApiOperation({ summary: 'Update spare part quantity' })
  async updateSparePartQuantity(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('partId') partId: string,
    @Body('quantity') quantity: number,
  ) {
    const userId = getUserIdFromUser(user);
    if (quantity === undefined || quantity < 1) {
      throw new BadRequestException('Invalid quantity');
    }
    return this.technicianBookingService.updateSparePartQuantity(userId, id, partId, quantity);
  }

  @Delete(':id/spare-parts/:partId')
  @ApiOperation({ summary: 'Remove a spare part' })
  async removeSparePart(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('partId') partId: string,
  ) {
    const userId = getUserIdFromUser(user);
    return this.technicianBookingService.removeSparePart(userId, id, partId);
  }
}
