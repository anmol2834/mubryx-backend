import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { FastifyRequest } from 'fastify';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('devices')
  async registerDevice(
    @Req() req: FastifyRequest,
    @Body() body: { pushToken: string; deviceId?: string; platform?: string }
  ) {
    const userId = (req as any).user.id;
    return this.notificationsService.registerDevice(userId, body);
  }
}


