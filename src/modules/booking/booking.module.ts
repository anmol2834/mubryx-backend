import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { DispatchService } from './dispatch.service';
import { AssignmentService } from './assignment.service';

import { NotificationsModule } from '@modules/notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';
import { StorageModule } from '../../infrastructure/storage/storage.module';

import { PdfInvoiceService } from './pdf-invoice.service';
import { InvoiceService } from './invoice.service';

@Module({
  imports: [NotificationsModule, WalletModule, StorageModule],
  controllers: [BookingController],
  providers: [BookingService, DispatchService, AssignmentService, PdfInvoiceService, InvoiceService],
  exports: [BookingService, DispatchService, AssignmentService, PdfInvoiceService, InvoiceService],
})
export class BookingModule {}
