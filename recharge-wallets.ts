import { PrismaClient } from './src/generated/prisma/client.ts';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  
  const wallets = await prisma.technicianWallet.findMany();
  for (const wallet of wallets) {
    const updated = await prisma.technicianWallet.update({
      where: { id: wallet.id },
      data: { availableBalance: { increment: 5000 } }
    });
    console.log(`Recharged wallet ${wallet.id}. New balance: ${updated.availableBalance}`);
  }
}

main().catch(console.error).finally(() => process.exit(0));
