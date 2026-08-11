import { Module } from '@nestjs/common';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { NotificationsController } from '@modules/notifications/notifications.controller';
import { PrismaModule } from '@prisma-service/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}


