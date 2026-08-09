export interface UploadOptions {
  key: string;
  buffer: Buffer;
  mimeType: string;
  isPrivate?: boolean;
}

export interface StorageProvider {
  upload(options: UploadOptions): Promise<string>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  exists(key: string): Promise<boolean>;
}

export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';
