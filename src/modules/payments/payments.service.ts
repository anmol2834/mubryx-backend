import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
let RazorpaySdk: any;
try {
  RazorpaySdk = require('razorpay');
} catch {
  // Safe fallback if optional SDK dependency is not installed
}

import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private razorpay?: any;
  private readonly keySecret: string;

  constructor(
    private configService: ConfigService,
    private walletService: WalletService,
  ) {
    const keyId = this.configService.get<string>('RAZORPAY_KEY_ID');
    const keySecret = this.configService.get<string>('RAZORPAY_KEY_SECRET');

    this.keySecret = keySecret || '';

    if (RazorpaySdk && keyId && keySecret) {
      this.razorpay = new RazorpaySdk({
        key_id: keyId,
        key_secret: keySecret,
      });
    } else {
      this.logger.warn('Razorpay SDK or credentials missing from environment variables');
    }
  }

  async createOrder(amount: number, currency: string, receipt: string, notes?: Record<string, string>): Promise<any> {
    if (!this.razorpay) {
      throw new Error('Razorpay SDK not initialized');
    }
    
    return this.razorpay.orders.create({
      amount,
      currency,
      receipt,
      notes,
    });
  }

  async verifyPayment(orderId: string, paymentId: string, signature: string): Promise<boolean> {
    const text = orderId + '|' + paymentId;
    const expectedSignature = crypto
      .createHmac('sha256', this.keySecret)
      .update(text)
      .digest('hex');

    if (expectedSignature !== signature) {
      return false;
    }

    if (!this.razorpay) {
      throw new Error('Razorpay SDK not initialized');
    }

    // Securely fetch order details to read notes
    const order = await this.razorpay.orders.fetch(orderId);
    if (!order) {
      throw new BadRequestException('Order not found in Razorpay');
    }

    const { notes, amount } = order;
    const amountInRupees = Number(amount) / 100;

    // Process Fulfillment based on notes
    if (notes && notes.type === 'WALLET_RECHARGE' && notes.targetId) {
      await this.walletService.rechargeWallet(
        notes.targetId as string,
        amountInRupees,
        paymentId,
      );
      this.logger.log(`Successfully recharged wallet for ${notes.targetId} with ₹${amountInRupees}`);
    }

    return true;
  }
}
