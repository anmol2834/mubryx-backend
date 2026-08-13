import { PrismaClient } from './src/generated/prisma/client';

const prisma = new PrismaClient();

async function main() {
  const wallets = await prisma.technicianWallet.findMany({
    include: {
      technician: {
        include: { user: true }
      }
    }
  });
  console.log(JSON.stringify(wallets, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
