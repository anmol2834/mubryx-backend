import { Injectable, Logger } from '@nestjs/common';
import { StorageProvider, UploadOptions } from './storage.provider';

@Injectable()
export class MockStorageProvider implements StorageProvider {
  private readonly logger = new Logger(MockStorageProvider.name);

  async upload(options: UploadOptions): Promise<string> {
    this.logger.debug(`[MOCK] Upload: ${options.key} (${options.mimeType})`);
    return `mock://storage/${options.key}`;
  }

  async delete(key: string): Promise<void> {
    this.logger.debug(`[MOCK] Delete: ${key}`);
  }

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    this.logger.debug(`[MOCK] SignedUrl: ${key} expires=${expiresInSeconds}s`);
    return `mock://storage/${key}?expires=${expiresInSeconds}`;
  }

  async exists(key: string): Promise<boolean> {
    this.logger.debug(`[MOCK] Exists: ${key}`);
    return false;
  }
}
