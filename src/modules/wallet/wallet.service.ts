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
          reservedBalance: 0,
          ledgerBalance: 0,
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
          data: { technicianId, availableBalance: 0, reservedBalance: 0, ledgerBalance: 0 },
        });
      }

      const balanceBefore = wallet.availableBalance;
      const balanceAfter = balanceBefore + amount;

      const updatedWallet = await tx.technicianWallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: { increment: amount },
          ledgerBalance: { increment: amount },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'RECHARGE',
          amount,
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
   * Reserves an amount from the available balance (e.g., when a job is accepted).
   */
  async reserveAmount(technicianId: string, amount: number, bookingId: string, txClient?: any) {
    if (amount <= 0) return null;

    const prismaClient = txClient || this.prisma;
    
    // We do NOT start a new transaction if we're already inside one (via txClient)
    const reserveLogic = async (tx: Prisma.TransactionClient) => {
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

      const balanceBefore = wallet.availableBalance;
      const balanceAfter = balanceBefore - amount;

      const updatedCount = await tx.technicianWallet.updateMany({
        where: { id: wallet.id, availableBalance: { gte: amount } },
        data: {
          availableBalance: { decrement: amount },
          reservedBalance: { increment: amount },
        },
      });

      if (!updatedCount || updatedCount.count === 0) {
        throw new BadRequestException({
          message: 'Insufficient wallet balance to accept this job or concurrent modification. Please try again.',
          requiredAmount: amount,
          currentBalance: wallet.availableBalance,
        });
      }

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'COMMISSION_RESERVATION',
          amount: -amount,
          balanceBefore,
          balanceAfter,
          referenceId: bookingId,
          description: `Commission reserved for booking ${bookingId}`,
        },
      });

      return true;
    };

    if (txClient) {
      return reserveLogic(txClient);
    } else {
      return this.prisma.$transaction(reserveLogic);
    }
  }

  /**
   * Captures a reserved amount (e.g., when a job is completed).
   */
  async captureReservedAmount(technicianId: string, amount: number, bookingId: string, txClient?: any) {
    if (amount <= 0) return null;

    const prismaClient = txClient || this.prisma;

    const captureLogic = async (tx: Prisma.TransactionClient) => {
      const wallet = await tx.technicianWallet.findUnique({
        where: { technicianId },
      });

      if (!wallet) throw new BadRequestException('Wallet not found');
      
      // If reserved balance is less, we just capture whatever is reserved.
      // This handles edge cases where commission was somehow miscalculated previously.
      const captureAmount = Math.min(wallet.reservedBalance, amount);
      if (captureAmount <= 0) return wallet;

      const balanceBefore = wallet.availableBalance; 
      const balanceAfter = wallet.availableBalance;

      const updatedWallet = await tx.technicianWallet.update({
        where: { id: wallet.id },
        data: {
          reservedBalance: { decrement: captureAmount },
          ledgerBalance: { decrement: captureAmount },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'COMMISSION_CAPTURE',
          amount: -captureAmount, // Negative on ledger balance conceptually
          balanceBefore,
          balanceAfter,
          referenceId: bookingId,
          description: `Commission captured for completed booking ${bookingId}`,
        },
      });

      return updatedWallet;
    };

    if (txClient) {
      return captureLogic(txClient);
    } else {
      return this.prisma.$transaction(captureLogic);
    }
  }

  /**
   * Releases a reserved amount back to available balance (e.g., when a job is cancelled).
   */
  async releaseReservedAmount(technicianId: string, amount: number, bookingId: string, txClient?: any) {
    if (amount <= 0) return null;

    const releaseLogic = async (tx: Prisma.TransactionClient) => {
      const wallet = await tx.technicianWallet.findUnique({
        where: { technicianId },
      });

      if (!wallet) throw new BadRequestException('Wallet not found');

      const amountToRelease = Math.min(wallet.reservedBalance, amount);
      const balanceBefore = wallet.availableBalance;
      const balanceAfter = balanceBefore + amount;

      const updatedCount = await tx.technicianWallet.updateMany({
        where: { id: wallet.id, reservedBalance: { gte: amount } },
        data: {
          reservedBalance: { decrement: amount },
          availableBalance: { increment: amount },
        },
      });

      if (!updatedCount || updatedCount.count === 0) {
        throw new BadRequestException('Insufficient reserved balance for release.');
      }

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'COMMISSION_RELEASE',
          amount: amountToRelease,
          balanceBefore,
          balanceAfter,
          referenceId: bookingId,
          description: `Reserved commission released for booking ${bookingId}`,
        },
      });

      return true;
    };

    if (txClient) {
      return releaseLogic(txClient);
    } else {
      return this.prisma.$transaction(releaseLogic);
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

      const balanceBefore = wallet.availableBalance;
      const balanceAfter = balanceBefore + amount;

      const updatedWallet = await tx.technicianWallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: { increment: amount },
          ledgerBalance: { increment: amount },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'JOB_EARNING',
          amount,
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
}
