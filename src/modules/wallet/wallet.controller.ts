import { Controller, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('Wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/technicians/wallet')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('recharge')
  @ApiOperation({ summary: 'Simulate recharging the technician wallet' })
  async rechargeWallet(@CurrentUser() user: any, @Body() body: { amount: number }) {
    const userId = user?.id || user?.sub;
    if (!userId) throw new BadRequestException('User ID not found in token');

    const profile = await this.prisma.technicianProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new BadRequestException('Technician profile not found');
    }

    const updatedWallet = await this.walletService.rechargeWallet(
      profile.id,
      body.amount,
      `SIMULATED_RECHARGE_${Date.now()}`
    );

    return {
      success: true,
      message: `Successfully recharged ₹${body.amount}`,
      wallet: updatedWallet,
    };
  }
}
