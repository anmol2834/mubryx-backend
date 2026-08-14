import { Module } from '@nestjs/common';
import { TechniciansController } from './technicians.controller';
import { TechniciansService } from './technicians.service';
import { TechnicianBookingController } from './technician-booking.controller';
import { TechnicianBookingService } from './technician-booking.service';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, StorageModule, WalletModule, NotificationsModule],
  controllers: [TechniciansController, TechnicianBookingController],
  providers: [TechniciansService, TechnicianBookingService],
  exports: [TechniciansService],
})
export class TechniciansModule {}
