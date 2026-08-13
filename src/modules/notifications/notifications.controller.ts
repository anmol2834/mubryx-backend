import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FastifyRequest } from 'fastify';

function getUserIdFromUser(user: any): string {
  return user?.userId || user?.id || user?.sub;
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('devices')
  async registerDevice(
    @Req() req: FastifyRequest,
    @Body() body: { pushToken: string; deviceId?: string; platform?: string },
  ) {
    const user = (req as any).user;
    const userId = getUserIdFromUser(user);
    return this.notificationsService.registerDevice(userId, body);
  }
}



