import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { DeactivateDeviceDto } from './dto/deactivate-device.dto';
import { TestNotificationDto } from './dto/test-notification.dto';

function getUserIdFromPayload(user: JwtPayload | any): string {
  return user?.sub || user?.userId || user?.id;
}

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('devices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register or update native device push token for authenticated technician/user' })
  @ApiResponse({ status: 200, description: 'Device token registered successfully' })
  @ApiResponse({ status: 400, description: 'Invalid token or payload format' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async registerDevice(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RegisterDeviceDto,
  ) {
    const userId = getUserIdFromPayload(user);
    return this.notificationsService.registerDevice(userId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('devices/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate device push token on technician logout' })
  @ApiResponse({ status: 200, description: 'Device deactivated successfully' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async deactivateDevice(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DeactivateDeviceDto,
  ) {
    const userId = getUserIdFromPayload(user);
    return this.notificationsService.deactivateDevice(userId, dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send standalone test FCM push notification to authenticated user devices' })
  @ApiResponse({ status: 200, description: 'Test notification dispatched' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async sendTestNotification(
    @CurrentUser() user: JwtPayload,
    @Body() dto: TestNotificationDto,
  ) {
    const userId = getUserIdFromPayload(user);
    return this.notificationsService.sendTestNotification(userId, dto);
  }
}
