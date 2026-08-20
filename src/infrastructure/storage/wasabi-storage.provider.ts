import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageProvider, UploadOptions } from './storage.provider';

@Injectable()
export class WasabiStorageProvider implements StorageProvider {
  private readonly logger = new Logger(WasabiStorageProvider.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;
  private bucketChecked = false;

  constructor(private readonly configService: ConfigService) {
    this.endpoint =
      this.configService.get<string>('storage.wasabi.endpoint') ||
      'https://s3.ap-southeast-1.wasabisys.com';
    const region =
      this.configService.get<string>('storage.wasabi.region') || 'ap-southeast-1';
    const accessKeyId =
      this.configService.get<string>('storage.wasabi.accessKey') || '';
    const secretAccessKey =
      this.configService.get<string>('storage.wasabi.secretKey') || '';
    this.bucket =
      this.configService.get<string>('storage.wasabi.bucket') ||
      'mubryx-technician-private';

    this.s3Client = new S3Client({
      endpoint: this.endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true, // Required for Wasabi / S3-compatible storage
    });

    this.logger.log(
      `Initialized WasabiStorageProvider for bucket: "${this.bucket}" at ${this.endpoint}`,
    );
  }

  private async ensureBucketExists(): Promise<void> {
    if (this.bucketChecked) return;
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.bucketChecked = true;
    } catch (err: any) {
      const statusCode = err?.$metadata?.httpStatusCode;
      if (
        statusCode === 404 ||
        err?.name === 'NotFound' ||
        err?.name === 'NoSuchBucket'
      ) {
        this.logger.log(`Bucket "${this.bucket}" does not exist. Creating bucket on Wasabi...`);
        try {
          await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucket }));
          this.logger.log(`Successfully created bucket "${this.bucket}" on Wasabi.`);
          this.bucketChecked = true;
        } catch (createErr: any) {
          this.logger.error(`Failed to create bucket "${this.bucket}": ${createErr?.message}`);
        }
      } else {
        this.logger.warn(`HeadBucket check for "${this.bucket}" encountered warning: ${err?.message}`);
        // Mark as checked to prevent infinite retry loops if bucket permissions allow Put but not Head
        this.bucketChecked = true;
      }
    }
  }

  async upload(options: UploadOptions): Promise<string> {
    await this.ensureBucketExists();

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: options.key,
      Body: options.buffer,
      ContentType: options.mimeType,
    });

    await this.s3Client.send(command);

    const publicUrl = `${this.endpoint.replace(/\/$/, '')}/${this.bucket}/${options.key.replace(/^\//, '')}`;
    this.logger.log(`[WASABI SUCCESS] File uploaded to Wasabi S3: ${publicUrl}`);
    return publicUrl;
  }

  async delete(key: string): Promise<void> {
    await this.ensureBucketExists();

    let objectKey = key;
    if (key.startsWith('http://') || key.startsWith('https://')) {
      const urlParts = key.split(`${this.bucket}/`);
      if (urlParts.length > 1) {
        objectKey = urlParts[1];
      }
    }

    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });

    await this.s3Client.send(command);
    this.logger.log(`[WASABI DELETE] Deleted object key from Wasabi S3: ${objectKey}`);
  }

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    if (!key) return key;
    if (key.startsWith('http://') || key.startsWith('https://')) {
      if (!key.includes(this.bucket)) {
        return key;
      }
    }
    await this.ensureBucketExists();

    let objectKey = key;
    if (key.startsWith('http://') || key.startsWith('https://')) {
      const urlParts = key.split(`${this.bucket}/`);
      if (urlParts.length > 1) {
        objectKey = urlParts[1];
      }
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
  }

  async exists(key: string): Promise<boolean> {
    await this.ensureBucketExists();

    let objectKey = key;
    if (key.startsWith('http://') || key.startsWith('https://')) {
      const urlParts = key.split(`${this.bucket}/`);
      if (urlParts.length > 1) {
        objectKey = urlParts[1];
      }
    }

    try {
      await this.s3Client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
