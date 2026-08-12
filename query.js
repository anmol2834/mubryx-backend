const { PrismaClient } = require('./src/generated/prisma');
const prisma = new PrismaClient();

async function main() {
  const b = await prisma.booking.findUnique({
    where: { id: 'cmsq2mgj20001n0idb66nh6bq' }
  });
  console.log(JSON.stringify(b, null, 2));
}

main().finally(() => prisma.$disconnect());
