const { PrismaClient } = require('./src/generated/prisma/client');
const prisma = new PrismaClient();
async function main() {
  const techs = await prisma.technicianProfile.findMany();
  console.log(JSON.stringify(techs, null, 2));
}
main().finally(() => prisma.$disconnect());
