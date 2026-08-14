require('dotenv').config();
const { PrismaClient } = require('./dist/generated/prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const userId = 'cmsnm4zy000009widtbwgxp6u';
  const profile = await prisma.technicianProfile.findUnique({
    where: { userId },
    include: { skills: true }
  });

  const dispatches = await prisma.bookingDispatch.findMany({
    where: {
      technicianId: profile.id,
      status: 'OFFERED',
      booking: { status: 'TECHNICIAN_SEARCHING' },
    },
    include: {
      bookingItem: {
        include: {
          service: true,
        },
      },
      booking: {
        include: {
          customer: {
            select: { name: true, phone: true },
          },
          items: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log('Nearby Leads Dispatches count:', dispatches.length);
  console.log(JSON.stringify(dispatches, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
