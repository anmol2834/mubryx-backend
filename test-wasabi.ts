import { ConfigService } from '@nestjs/config';
import { WasabiStorageProvider } from './src/infrastructure/storage/wasabi-storage.provider';

async function test() {
  const configService = {
    get: (key: string) => {
      if (key === 'storage.wasabi.endpoint') return 'https://s3.ap-southeast-1.wasabisys.com';
      if (key === 'storage.wasabi.region') return 'ap-southeast-1';
      if (key === 'storage.wasabi.accessKey') return 'J3Q1XQY2Q5P7R9S1T3V4'; // Mock
      if (key === 'storage.wasabi.secretKey') return 'P9S1T3V4W6Y8Z0A2B4C6'; // Mock
      if (key === 'storage.wasabi.bucket') return 'mubryx-technician-private';
      return null;
    }
  } as ConfigService;
  
  const provider = new WasabiStorageProvider(configService);
  const url = await provider.getSignedUrl('https://s3.ap-southeast-1.wasabisys.com/mubryx-technician-private/technicians/cmsnm504n00019widlj2p8sf3/photo_1786389466026.jpeg');
  console.log(url);
}

test();
