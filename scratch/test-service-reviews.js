const { PrismaClient } = require('./src/generated/prisma/client');

async function testServiceReviews() {
  const prisma = new PrismaClient();
  try {
    console.log('Connecting to Neon Database...');
    await prisma.$connect();
    console.log('Successfully connected!');

    // Find any service
    const service = await prisma.service.findFirst();
    if (!service) {
      console.log('No service found in DB');
      return;
    }

    console.log('Found test service:', { id: service.id, title: service.title, rating: service.rating, reviewCount: service.reviewCount });

    // Check existing reviews for service
    const reviews = await prisma.review.findMany({
      where: { serviceId: service.id },
    });

    console.log(`Found ${reviews.length} reviews for service ${service.title}`);
    console.log('Test completed successfully!');
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

testServiceReviews();
