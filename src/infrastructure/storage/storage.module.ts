import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STORAGE_PROVIDER } from './storage.provider';
import { MockStorageProvider } from './mock-storage.provider';

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      useFactory: (config: ConfigService) => {
        const provider = config.get<string>('storage.provider');
        if (provider === 'wasabi') {
          // WasabiStorageProvider will be injected here when implemented
          throw new Error('Wasabi provider not yet implemented — set STORAGE_PROVIDER=mock for now');
        }
        return new MockStorageProvider();
      },
      inject: [ConfigService],
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
