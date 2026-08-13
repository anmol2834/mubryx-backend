import { PrismaClient } from './src/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  
  const profiles = await prisma.technicianProfile.findMany({ include: { wallet: true } });
  for (const profile of profiles) {
    if (!profile.wallet) {
      console.log(`Profile ${profile.id} has NO wallet! Recharging by creating...`);
      await prisma.technicianWallet.create({
        data: {
          technicianId: profile.id,
          availableBalance: 5000,
          reservedBalance: 0
        }
      });
    } else {
      console.log(`Profile ${profile.id} has wallet. Balance: ${profile.wallet.availableBalance}`);
      await prisma.technicianWallet.update({
        where: { id: profile.wallet.id },
        data: { availableBalance: 5000 }
      });
    }
  }
}

main().catch(console.error).finally(() => process.exit(0));
