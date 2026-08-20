import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_PROVIDER, StorageProvider } from '../../infrastructure/storage/storage.provider';
import { PdfInvoiceService } from './pdf-invoice.service';
import { RealtimeService } from '../../realtime/services/realtime.service';

import { REALTIME_EVENTS } from '../../realtime/constants/realtime-events.constant';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfInvoiceService: PdfInvoiceService,
    private readonly realtimeService: RealtimeService,
    @Inject(STORAGE_PROVIDER) private readonly storageProvider: StorageProvider,
  ) {}

  /**
   * Generates a legal A4 PDF invoice, uploads it to Wasabi S3, and updates the Booking DB record.
   * Is idempotent: if an invoiceUrl already exists, skips generation and returns existing metadata.
   */
  async generateAndUploadInvoice(bookingId: string): Promise<{ invoiceNumber: string; invoiceUrl: string }> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: true,
        items: { include: { service: true } },
        spareParts: true,
        technician: { include: { user: true } },
      },
    });

    if (!booking) {
      throw new NotFoundException(`Booking '${bookingId}' not found for invoice generation`);
    }

    // Idempotency check: Never regenerate if invoice already exists
    if (booking.invoiceUrl && booking.invoiceNumber) {
      this.logger.log(`Invoice already exists for booking ${bookingId}: ${booking.invoiceNumber}`);
      let signedUrl = booking.invoiceUrl;
      try {
        signedUrl = await this.storageProvider.getSignedUrl(booking.invoiceUrl, 604800);
      } catch {
        // Fallback
      }
      return {
        invoiceNumber: booking.invoiceNumber,
        invoiceUrl: signedUrl,
      };
    }

    // Generate unique sequential invoice number
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const seq = booking.bookingNumber.includes('-')
      ? booking.bookingNumber.split('-').pop()
      : booking.id.slice(-6).toUpperCase();

    const invoiceNumber = `INV-MBX-${yyyy}${mm}${dd}-${seq}`;

    const sparePartsTotal = (booking.spareParts || []).reduce(
      (sum, p) => sum + p.unitPrice * p.quantity,
      0,
    );

    const invoiceDateFormatted = now.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

    const preparedBooking = {
      ...booking,
      invoiceNumber,
      invoiceDateFormatted,
      customerName: booking.customer?.name || 'Valued Customer',
      customerPhone: booking.customer?.phone || 'N/A',
      customerAddress: booking.snapshotAddress || 'N/A',
      placeOfSupply: `${booking.snapshotCity || 'Ahmedabad'}, ${booking.snapshotState || 'Gujarat'} (24)`,
      sparePartsTotal,
      technicianName: booking.technician?.fullName || booking.technician?.user?.name || null,
    };

    this.logger.log(`Generating PDF invoice for booking ${bookingId} (${invoiceNumber})...`);
    const pdfBuffer = await this.pdfInvoiceService.generateInvoicePdf(preparedBooking);

    const objectKey = `invoices/${booking.id}/${invoiceNumber}.pdf`;
    this.logger.log(`Uploading invoice PDF to Wasabi storage (${objectKey})...`);

    const publicUrl = await this.storageProvider.upload({
      key: objectKey,
      buffer: pdfBuffer,
      mimeType: 'application/pdf',
    });

    const updatedBooking = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        invoiceNumber,
        invoiceUrl: publicUrl,
        invoiceGeneratedAt: new Date(),
      },
    });

    let signedInvoiceUrl = publicUrl;
    try {
      signedInvoiceUrl = await this.storageProvider.getSignedUrl(objectKey, 604800);
    } catch {
      // Fallback
    }

    this.logger.log(`Successfully generated and saved invoice for booking ${bookingId}: ${signedInvoiceUrl}`);

    // Emit real-time socket event with presigned URL
    this.realtimeService.emitBookingEvent(bookingId, REALTIME_EVENTS.BOOKING.INVOICE_READY, {
      bookingId,
      bookingNumber: booking.bookingNumber,
      customerId: booking.customerId,
      status: booking.status,
      invoiceNumber,
      invoiceUrl: signedInvoiceUrl,
      updatedAt: new Date().toISOString(),
    });

    return {
      invoiceNumber,
      invoiceUrl: signedInvoiceUrl,
    };
  }
}
