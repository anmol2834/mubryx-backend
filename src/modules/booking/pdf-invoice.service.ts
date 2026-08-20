import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';

function numberToWordsINR(amount: number): string {
  const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertChunk(num: number): string {
    let str = '';
    if (num >= 100) {
      str += units[Math.floor(num / 100)] + ' Hundred ';
      num %= 100;
    }
    if (num >= 20) {
      str += tens[Math.floor(num / 10)] + ' ';
      num %= 10;
    }
    if (num > 0) {
      str += units[num] + ' ';
    }
    return str.trim();
  }

  const rounded = Math.round(amount * 100) / 100;
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);

  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';

  let rupeesStr = '';
  let tempRupees = rupees;

  if (tempRupees >= 10000000) {
    const crore = Math.floor(tempRupees / 10000000);
    rupeesStr += convertChunk(crore) + ' Crore ';
    tempRupees %= 10000000;
  }
  if (tempRupees >= 100000) {
    const lakh = Math.floor(tempRupees / 100000);
    rupeesStr += convertChunk(lakh) + ' Lakh ';
    tempRupees %= 100000;
  }
  if (tempRupees >= 1000) {
    const thousand = Math.floor(tempRupees / 1000);
    rupeesStr += convertChunk(thousand) + ' Thousand ';
    tempRupees %= 1000;
  }
  if (tempRupees > 0) {
    rupeesStr += convertChunk(tempRupees);
  }

  rupeesStr = rupeesStr.trim() ? `${rupeesStr.trim()} Rupees` : '';
  const paiseStr = paise > 0 ? `${convertChunk(paise)} Paise` : '';

  if (rupeesStr && paiseStr) {
    return `${rupeesStr} and ${paiseStr} Only`;
  }
  return `${rupeesStr || paiseStr} Only`;
}

@Injectable()
export class PdfInvoiceService {
  private readonly logger = new Logger(PdfInvoiceService.name);

  async generateInvoicePdf(booking: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 40,
          info: {
            Title: `Tax Invoice - ${booking.invoiceNumber || booking.bookingNumber}`,
            Author: 'Mubryx Technology OPC PVT. LTD.',
            Subject: 'Tax Invoice for Home Services',
          },
        });

        const buffers: Buffer[] = [];
        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err) => reject(err));

        const brandBlue = '#0052CC';
        const darkInk = '#0F172A';
        const slateText = '#334155';
        const mutedText = '#64748B';
        const lightBg = '#F8FAFC';
        const borderSlate = '#E2E8F0';

        // ─── Header Section ──────────────────────────────────────────────────────────
        doc.fillColor(brandBlue)
           .fontSize(22)
           .font('Helvetica-Bold')
           .text('Mubryx', 40, 40);

        doc.fillColor(darkInk)
           .fontSize(11)
           .font('Helvetica-Bold')
           .text('Mubryx Technology OPC PVT. LTD.', 40, 68);

        doc.fontSize(8.5)
           .font('Helvetica')
           .fillColor(mutedText)
           .text('304 Spinel, Sarkhej - Gandhinagar Hwy, opp. Gujarat High Court,', 40, 83)
           .text('near Kargil Petrol pump, Gota, Ahmedabad, Gujarat 382481', 40, 95)
           .text('Email: info@mubryx.com  |  Web: mubryx.com', 40, 107)
           .font('Helvetica-Bold')
           .fillColor(darkInk)
           .text('GSTIN: _______________', 40, 119);

        // Right Header — Title & Badge
        doc.fillColor(brandBlue)
           .fontSize(20)
           .font('Helvetica-Bold')
           .text('TAX INVOICE', 380, 40, { align: 'right', width: 175 });

        doc.fillColor(mutedText)
           .fontSize(8)
           .font('Helvetica')
           .text('ORIGINAL FOR RECIPIENT', 380, 64, { align: 'right', width: 175 });

        // Accent Divider Bar
        doc.rect(40, 137, 515, 2).fill(brandBlue);

        // ─── Metadata & Bill To Grid ────────────────────────────────────────────────
        doc.rect(40, 147, 515, 80).fillAndStroke(lightBg, borderSlate);

        // Left Metadata Box
        doc.fillColor(mutedText).fontSize(8).font('Helvetica-Bold').text('INVOICE DETAILS', 52, 155);
        doc.fillColor(slateText).font('Helvetica').fontSize(8.5);
        doc.text(`Invoice No:`, 52, 169).font('Helvetica-Bold').text(`${booking.invoiceNumber || 'INV-PENDING'}`, 110, 169);
        doc.font('Helvetica').text(`Invoice Date:`, 52, 183).font('Helvetica-Bold').text(`${booking.invoiceDateFormatted || 'Today'}`, 110, 183);
        doc.font('Helvetica').text(`Booking No:`, 52, 197).font('Helvetica-Bold').text(`${booking.bookingNumber}`, 110, 197);
        doc.font('Helvetica').text(`Place of Supply:`, 52, 211).font('Helvetica-Bold').text(`${booking.placeOfSupply || 'Gujarat (24)'}`, 120, 211);

        // Right Customer Bill To Box
        doc.fillColor(mutedText).fontSize(8).font('Helvetica-Bold').text('BILL TO (CUSTOMER)', 310, 155);
        doc.fillColor(slateText).font('Helvetica').fontSize(8.5);
        doc.font('Helvetica-Bold').fillColor(darkInk).text(`${booking.customerName || 'Customer'}`, 310, 169);
        doc.font('Helvetica').fillColor(slateText).text(`Phone: ${booking.customerPhone || 'N/A'}`, 310, 183);
        doc.text(`Address: ${booking.customerAddress || 'N/A'}`, 310, 197, { width: 230, height: 20 });
        doc.text(`GSTIN: _______________`, 310, 213);

        // ─── Services Table ──────────────────────────────────────────────────────────
        let currentY = 240;

        doc.fillColor(darkInk).fontSize(10).font('Helvetica-Bold').text('SERVICES PROVIDED', 40, currentY);
        currentY += 15;

        // Table Header
        doc.rect(40, currentY, 515, 20).fill(brandBlue);
        doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold');
        doc.text('#', 48, currentY + 6, { width: 20 });
        doc.text('Service Description', 70, currentY + 6, { width: 240 });
        doc.text('Qty', 315, currentY + 6, { width: 30, align: 'center' });
        doc.text('Unit Price (₹)', 350, currentY + 6, { width: 70, align: 'right' });
        doc.text('Total (₹)', 430, currentY + 6, { width: 115, align: 'right' });
        currentY += 20;

        const items = booking.items || [];
        items.forEach((item: any, idx: number) => {
          const rowBg = idx % 2 === 0 ? '#FFFFFF' : lightBg;
          doc.rect(40, currentY, 515, 22).fillAndStroke(rowBg, borderSlate);
          doc.fillColor(slateText).fontSize(8.5).font('Helvetica');
          doc.text(String(idx + 1), 48, currentY + 6);
          doc.font('Helvetica-Bold').text(item.title || 'Service Item', 70, currentY + 6, { width: 240 });
          doc.font('Helvetica').text(String(item.quantity || 1), 315, currentY + 6, { width: 30, align: 'center' });
          doc.text(`₹${(item.unitPrice || 0).toFixed(2)}`, 350, currentY + 6, { width: 70, align: 'right' });
          doc.text(`₹${(item.lineTotal || 0).toFixed(2)}`, 430, currentY + 6, { width: 115, align: 'right' });
          currentY += 22;
        });

        // ─── Spare Parts Table (If Any) ─────────────────────────────────────────────
        const spareParts = booking.spareParts || [];
        if (spareParts.length > 0) {
          currentY += 12;
          doc.fillColor(darkInk).fontSize(10).font('Helvetica-Bold').text('SPARE PARTS & MATERIALS', 40, currentY);
          currentY += 15;

          doc.rect(40, currentY, 515, 20).fill('#334155');
          doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold');
          doc.text('#', 48, currentY + 6, { width: 20 });
          doc.text('Part Description', 70, currentY + 6, { width: 240 });
          doc.text('Qty', 315, currentY + 6, { width: 30, align: 'center' });
          doc.text('Unit Price (₹)', 350, currentY + 6, { width: 70, align: 'right' });
          doc.text('Total (₹)', 430, currentY + 6, { width: 115, align: 'right' });
          currentY += 20;

          spareParts.forEach((part: any, idx: number) => {
            const rowBg = idx % 2 === 0 ? '#FFFFFF' : lightBg;
            const partTotal = (part.unitPrice || 0) * (part.quantity || 1);
            doc.rect(40, currentY, 515, 22).fillAndStroke(rowBg, borderSlate);
            doc.fillColor(slateText).fontSize(8.5).font('Helvetica');
            doc.text(String(idx + 1), 48, currentY + 6);
            doc.font('Helvetica-Bold').text(part.name || 'Spare Part', 70, currentY + 6, { width: 240 });
            doc.font('Helvetica').text(String(part.quantity || 1), 315, currentY + 6, { width: 30, align: 'center' });
            doc.text(`₹${(part.unitPrice || 0).toFixed(2)}`, 350, currentY + 6, { width: 70, align: 'right' });
            doc.text(`₹${partTotal.toFixed(2)}`, 430, currentY + 6, { width: 115, align: 'right' });
            currentY += 22;
          });
        }

        // ─── Financial Calculations Box ─────────────────────────────────────────────
        currentY += 15;
        const summaryY = currentY;

        // Left Side: Amount in Words
        const wordsText = numberToWordsINR(booking.totalAmount || 0);
        doc.rect(40, summaryY, 280, 80).fillAndStroke(lightBg, borderSlate);
        doc.fillColor(mutedText).fontSize(8).font('Helvetica-Bold').text('AMOUNT IN WORDS', 48, summaryY + 8);
        doc.fillColor(darkInk).fontSize(9).font('Helvetica-Bold').text(wordsText, 48, summaryY + 22, { width: 264 });

        if (booking.technicianName) {
          doc.fillColor(mutedText).fontSize(8).font('Helvetica').text(`Serviced by: `, 48, summaryY + 58)
             .font('Helvetica-Bold').fillColor(slateText).text(booking.technicianName, 102, summaryY + 58);
        }

        // Right Side: Financial Breakdown
        const rightBoxX = 330;
        const rightBoxWidth = 225;
        doc.rect(rightBoxX, summaryY, rightBoxWidth, 80).fillAndStroke('#FFFFFF', borderSlate);

        const subtotalVal = booking.subtotal || 0;
        const spareVal = booking.sparePartsTotal || 0;
        const totalTaxable = subtotalVal + spareVal;
        const cgstVal = Math.round((booking.tax / 2) * 100) / 100;
        const sgstVal = Math.round((booking.tax / 2) * 100) / 100;
        const grandTotalVal = booking.totalAmount || 0;

        let calcRowY = summaryY + 6;

        doc.fillColor(slateText).fontSize(8).font('Helvetica').text('Taxable Amount:', rightBoxX + 10, calcRowY);
        doc.text(`₹${totalTaxable.toFixed(2)}`, rightBoxX + 10, calcRowY, { align: 'right', width: rightBoxWidth - 20 });
        calcRowY += 14;

        doc.text('CGST (9%):', rightBoxX + 10, calcRowY);
        doc.text(`₹${cgstVal.toFixed(2)}`, rightBoxX + 10, calcRowY, { align: 'right', width: rightBoxWidth - 20 });
        calcRowY += 14;

        doc.text('SGST (9%):', rightBoxX + 10, calcRowY);
        doc.text(`₹${sgstVal.toFixed(2)}`, rightBoxX + 10, calcRowY, { align: 'right', width: rightBoxWidth - 20 });
        calcRowY += 16;

        // Grand Total Row
        doc.rect(rightBoxX, calcRowY - 2, rightBoxWidth, 26).fill(brandBlue);
        doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold').text('Grand Total:', rightBoxX + 10, calcRowY + 4);
        doc.text(`₹${grandTotalVal.toFixed(2)}`, rightBoxX + 10, calcRowY + 4, { align: 'right', width: rightBoxWidth - 20 });

        // ─── Footer & Signatory ──────────────────────────────────────────────────────
        currentY = summaryY + 95;

        doc.rect(40, currentY, 515, 55).fillAndStroke(lightBg, borderSlate);

        // Left T&C
        doc.fillColor(mutedText).fontSize(7.5).font('Helvetica-Bold').text('TERMS & CONDITIONS', 48, currentY + 6);
        doc.fillColor(slateText).fontSize(7).font('Helvetica')
           .text('1. All services & spare parts provided carry warranty as per standard company policy.', 48, currentY + 18)
           .text('2. This is a computer-generated tax invoice and requires no physical signature.', 48, currentY + 28)
           .text('3. For support or queries, contact +91 93277 01171 or email info@mubryx.com', 48, currentY + 38);

        // Right Signatory Block
        doc.fillColor(mutedText).fontSize(7.5).font('Helvetica-Bold').text('FOR MUBRYX TECHNOLOGY OPC PVT. LTD.', 340, currentY + 6, { align: 'right', width: 205 });
        doc.fillColor(brandBlue).fontSize(8).font('Helvetica-Bold').text('Digitally Generated Invoice', 340, currentY + 36, { align: 'right', width: 205 });

        // Bottom Watermark / Page Indicator
        doc.fillColor(mutedText).fontSize(7).font('Helvetica')
           .text('Thank you for choosing Mubryx Services!', 40, doc.page.height - 25, { align: 'center', width: 515 });

        doc.end();
      } catch (err) {
        this.logger.error('Failed to generate PDF document:', err);
        reject(err);
      }
    });
  }
}
