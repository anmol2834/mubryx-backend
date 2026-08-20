import { Controller, Post, Body, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@Controller('api/v1/payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('create-order')
  @ApiOperation({ summary: 'Create a Razorpay order' })
  async createOrder(@Body() body: { amount: number; currency?: string; receipt?: string; notes?: Record<string, string> }) {
    if (!body.amount || body.amount < 100) {
      throw new BadRequestException('Amount must be at least 100 paise');
    }

    const currency = body.currency || 'INR';
    const receipt = body.receipt || `receipt_${Date.now()}`;

    try {
      const order = await this.paymentsService.createOrder(body.amount, currency, receipt, body.notes);
      return {
        success: true,
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
      };
    } catch (error: any) {
      throw new InternalServerErrorException(error?.message || 'Failed to create order');
    }
  }

  @Post('verify-payment')
  @ApiOperation({ summary: 'Verify a Razorpay payment signature' })
  async verifyPayment(
    @Body()
    body: {
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    },
  ) {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new BadRequestException('Missing required payment verification fields');
    }

    const isValid = await this.paymentsService.verifyPayment(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    );

    if (!isValid) {
      throw new BadRequestException('Invalid payment signature');
    }

    return {
      success: true,
      message: 'Payment verified successfully',
    };
  }
}
