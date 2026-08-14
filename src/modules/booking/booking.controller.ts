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
import { BookingService } from './booking.service';
import { AssignmentService } from './assignment.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

function getCustomerId(user: any): string {
  const id = user?.userId || user?.sub || user?.id;
  if (!id) throw new UnauthorizedException('Invalid or missing user context in token');
  return id;
}

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingController {
  constructor(
    private readonly bookingService: BookingService,
    private readonly assignmentService: AssignmentService,
  ) {}

  /**
   * POST /bookings
   * Create a new booking from the customer's active cart.
   * Transactional: validates cart + address + services → creates booking → clears cart.
   * Idempotent: same idempotencyKey returns existing booking.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async createBooking(
    @CurrentUser() user: any,
    @Body() dto: CreateBookingDto,
  ) {
    const customerId = getCustomerId(user);
    return this.bookingService.createBooking(customerId, dto);
  }

  /**
   * GET /bookings
   * List customer's bookings. Optional ?tab=upcoming|completed
   */
  @Get()
  async getBookings(
    @CurrentUser() user: any,
    @Query('tab') tab?: 'upcoming' | 'completed',
    @Query('status') status?: string,
  ) {
    const customerId = getCustomerId(user);
    return this.bookingService.getBookings(customerId, {
      tab,
      status: status as any,
    });
  }

  /**
   * GET /bookings/:id/technician-view
   * Technician reads current authoritative booking state after receiving a notification tap.
   * Authorization: technician must have a BookingDispatch record for this booking.
   * Returns booking data + technician's dispatch status so the frontend can determine
   * whether acceptance is still possible.
   */
  @Get(':id/technician-view')
  async getBookingForTechnician(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    const technicianUserId = getCustomerId(user);
    return this.bookingService.getBookingForTechnician(technicianUserId, id);
  }

  /**
   * GET /bookings/:id
   * Get booking details by internal ID (includes status history).
   */
  @Get(':id')
  async getBookingById(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    const customerId = getCustomerId(user);
    return this.bookingService.getBookingById(customerId, id);
  }

  /**
   * POST /bookings/:id/cancel
   * Cancel an eligible booking. Allowed statuses: PENDING_MATCHING, TECHNICIAN_SEARCHING, TECHNICIAN_ASSIGNED.
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelBooking(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
  ) {
    const customerId = getCustomerId(user);
    return this.bookingService.cancelBooking(customerId, id, dto);
  }

  /**
   * POST /bookings/:id/accept
   * Technician accepts a dispatched booking or service item.
   */
  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  async acceptBooking(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body?: { bookingItemId?: string },
  ) {
    const technicianUserId = getCustomerId(user);
    return this.assignmentService.acceptBooking(technicianUserId, id, body?.bookingItemId);
  }

  /**
   * POST /bookings/items/:itemId/accept
   * Technician accepts a specific dispatched service item.
   */
  @Post('items/:itemId/accept')
  @HttpCode(HttpStatus.OK)
  async acceptBookingItem(
    @CurrentUser() user: any,
    @Param('itemId') itemId: string,
  ) {
    const technicianUserId = getCustomerId(user);
    return this.assignmentService.acceptBooking(technicianUserId, itemId, itemId);
  }

  /**
   * POST /bookings/:id/reject
   * Technician rejects a dispatched booking or service item.
   */
  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectBooking(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body?: { bookingItemId?: string },
  ) {
    const technicianUserId = getCustomerId(user);
    return this.assignmentService.rejectBooking(technicianUserId, id, body?.bookingItemId);
  }

  /**
   * POST /bookings/items/:itemId/reject
   * Technician rejects a specific dispatched service item.
   */
  @Post('items/:itemId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectBookingItem(
    @CurrentUser() user: any,
    @Param('itemId') itemId: string,
  ) {
    const technicianUserId = getCustomerId(user);
    return this.assignmentService.rejectBooking(technicianUserId, itemId, itemId);
  }
}
