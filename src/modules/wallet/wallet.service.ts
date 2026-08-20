import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Gets or creates a wallet for a technician.
   */
  async getWallet(technicianId: string) {
    let wallet = await this.prisma.technicianWallet.findUnique({
      where: { technicianId },
    });

    if (!wallet) {
      wallet = await this.prisma.technicianWallet.create({
        data: {
          technicianId,
          availableBalance: 0,
        },
      });
    }

    return wallet;
  }

  /**
   * Recharge the wallet with a specified amount (used for testing or payment gateways).
   */
  async rechargeWallet(technicianId: string, amount: number, referenceId?: string) {
    if (amount <= 0) throw new BadRequestException('Amount must be greater than zero');

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let wallet = await tx.technicianWallet.findUnique({
        where: { technicianId },
      });

      if (!wallet) {
        wallet = await tx.technicianWallet.create({
          data: { technicianId, availableBalance: 0 },
        });
      }

      const cleanAmount = Math.round(amount * 100) / 100;
      const balanceBefore = Math.round(wallet.availableBalance * 100) / 100;
      const balanceAfter = Math.round((balanceBefore + cleanAmount) * 100) / 100;

      const updatedWallet = await tx.technicianWallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: balanceAfter,
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'RECHARGE',
          amount: cleanAmount,
          balanceBefore,
          balanceAfter,
          referenceId,
          description: 'Wallet recharge',
        },
      });

      return updatedWallet;
    });
  }

  /**
   * Validates if the technician has enough balance to accept a job.
   * Does NOT deduct or reserve any funds.
   */
  async validateEligibility(technicianId: string, amount: number, txClient?: any) {
    if (amount <= 0) return true;

    const prismaClient = txClient || this.prisma;
    
    const validateLogic = async (tx: Prisma.TransactionClient) => {
      const wallet = await tx.technicianWallet.findUnique({
        where: { technicianId },
      });

      if (!wallet) {
        throw new BadRequestException('Wallet not found. Please recharge first.');
      }

      if (wallet.availableBalance < amount) {
        throw new BadRequestException({
          message: 'Insufficient wallet balance to accept this job. Please recharge.',
          requiredAmount: amount,
          currentBalance: wallet.availableBalance,
        });
      }

      return true;
    };

    if (txClient) {
      return validateLogic(txClient);
    } else {
      return this.prisma.$transaction(validateLogic);
    }
  }

  /**
   * Charges commission and platform dues directly from available balance (used for Cash on Service).
   */
  async chargeCommission(technicianId: string, amount: number, bookingId: string, txClient?: any) {
    if (amount <= 0) return null;

    const chargeLogic = async (tx: Prisma.TransactionClient) => {
      const wallet = await tx.technicianWallet.findUnique({
        where: { technicianId },
      });

      if (!wallet) throw new BadRequestException('Wallet not found');
      
      const cleanAmount = Math.round(amount * 100) / 100;
      const balanceBefore = Math.round(wallet.availableBalance * 100) / 100; 
      const balanceAfter = Math.round((balanceBefore - cleanAmount) * 100) / 100;

      const updatedWallet = await tx.technicianWallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: balanceAfter,
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'CASH_COLLECTION_SETTLEMENT',
          amount: -cleanAmount,
          balanceBefore,
          balanceAfter,
          referenceId: bookingId,
          description: `Platform dues deducted for cash booking ${bookingId}`,
        },
      });

      return updatedWallet;
    };

    if (txClient) {
      return chargeLogic(txClient);
    } else {
      return this.prisma.$transaction(chargeLogic);
    }
  }

  /**
   * Adds earnings to the wallet (e.g., 80% share for completed job).
   */
  async addEarning(technicianId: string, amount: number, bookingId: string, txClient?: any) {
    if (amount <= 0) return null;

    const earningLogic = async (tx: Prisma.TransactionClient) => {
      const wallet = await tx.technicianWallet.findUnique({
        where: { technicianId },
      });

      if (!wallet) throw new BadRequestException('Wallet not found');

      const cleanAmount = Math.round(amount * 100) / 100;
      const balanceBefore = Math.round(wallet.availableBalance * 100) / 100;
      const balanceAfter = Math.round((balanceBefore + cleanAmount) * 100) / 100;

      const updatedWallet = await tx.technicianWallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: balanceAfter,
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'JOB_EARNING',
          amount: cleanAmount,
          balanceBefore,
          balanceAfter,
          referenceId: bookingId,
          description: `Earnings added for completed booking ${bookingId}`,
        },
      });

      return updatedWallet;
    };

    if (txClient) {
      return earningLogic(txClient);
    } else {
      return this.prisma.$transaction(earningLogic);
    }
  }



  /**
   * Adds the final commission and GST to the Admin Wallet.
   */
  async addAdminSettlement(commission: number, tax: number, bookingId: string, txClient?: any) {
    const totalAmount = commission + tax;
    if (totalAmount <= 0) return null;

    const adminLogic = async (tx: Prisma.TransactionClient) => {
      // Find or create the primary admin wallet
      let adminWallet = await tx.adminWallet.findFirst();
      if (!adminWallet) {
        adminWallet = await tx.adminWallet.create({
          data: {
            availableBalance: 0,
            totalCommission: 0,
            totalGstCollected: 0,
          },
        });
      }

      const balanceBefore = adminWallet.availableBalance;
      let currentBalance = balanceBefore;

      const updatedAdminWallet = await tx.adminWallet.update({
        where: { id: adminWallet.id },
        data: {
          availableBalance: { increment: totalAmount },
          totalCommission: { increment: commission },
          totalGstCollected: { increment: tax },
        },
      });

      if (commission > 0) {
        await tx.adminWalletTransaction.create({
          data: {
            walletId: adminWallet.id,
            type: 'PLATFORM_COMMISSION',
            amount: commission,
            balanceBefore: currentBalance,
            balanceAfter: currentBalance + commission,
            referenceId: bookingId,
            description: `Platform commission for booking ${bookingId}`,
          },
        });
        currentBalance += commission;
      }

      if (tax > 0) {
        await tx.adminWalletTransaction.create({
          data: {
            walletId: adminWallet.id,
            type: 'GST_COLLECTION',
            amount: tax,
            balanceBefore: currentBalance,
            balanceAfter: currentBalance + tax,
            referenceId: bookingId,
            description: `GST collected for booking ${bookingId}`,
          },
        });
        currentBalance += tax;
      }

      return updatedAdminWallet;
    };

    if (txClient) {
      return adminLogic(txClient);
    } else {
      return this.prisma.$transaction(adminLogic);
    }
  }
}
