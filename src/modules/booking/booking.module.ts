import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { DispatchService } from './dispatch.service';
import { AssignmentService } from './assignment.service';

import { NotificationsModule } from '@modules/notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [NotificationsModule, WalletModule],
  controllers: [BookingController],
  providers: [BookingService, DispatchService, AssignmentService],
  exports: [BookingService, DispatchService, AssignmentService],
})
export class BookingModule {}
