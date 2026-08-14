import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, initializeApp, cert, getApps, ServiceAccount } from 'firebase-admin/app';
import { getMessaging, Message, MulticastMessage, SendResponse } from 'firebase-admin/messaging';
import * as fs from 'fs';

export interface FcmNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
  channelId?: string;
  priority?: 'high' | 'normal';
}

export interface FcmSendResult {
  success: boolean;
  messageId?: string;
  isInvalidToken?: boolean;
  error?: string;
}

export interface FcmMulticastResult {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
}

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private app: App | null = null;
  private isMockMode = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    try {
      const existingApps = getApps();
      if (existingApps.length > 0) {
        this.app = existingApps[0]!;
        this.logger.log('Existing Firebase Admin app instance reused');
        return;
      }

      const serviceAccountKey = this.configService.get<string>('firebase.serviceAccountKey');
      const serviceAccountPath = this.configService.get<string>('firebase.serviceAccountPath');
      const projectId = this.configService.get<string>('firebase.projectId') || 'mubryx-alliance';
      const clientEmail = this.configService.get<string>('firebase.clientEmail');
      const privateKey = this.configService.get<string>('firebase.privateKey');

      let credentialObj: ServiceAccount | null = null;

      // Candidate key file paths (explicit env var, Render secret file mount, or local workspace file)
      const candidatePaths = [
        serviceAccountPath,
        '/etc/secrets/mubryx-alliance-firebase-adminsdk-fbsvc-c1df44dde6.json',
        '/etc/secrets/firebase-service-account.json',
        './mubryx-alliance-firebase-adminsdk-fbsvc-c1df44dde6.json',
        'mubryx-alliance-firebase-adminsdk-fbsvc-c1df44dde6.json',
      ].filter(Boolean) as string[];

      if (serviceAccountKey) {
        let parsed: any;
        try {
          parsed = JSON.parse(serviceAccountKey);
        } catch {
          // Attempt base64 decoding if raw string is not JSON
          try {
            const decoded = Buffer.from(serviceAccountKey, 'base64').toString('utf8');
            parsed = JSON.parse(decoded);
          } catch (e) {
            this.logger.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY JSON/Base64 string');
          }
        }

        if (parsed) {
          credentialObj = parsed as ServiceAccount;
          this.logger.log('Firebase Admin initialized with inline service account key');
        }
      }

      if (!credentialObj) {
        for (const filePath of candidatePaths) {
          if (fs.existsSync(filePath)) {
            try {
              const fileContent = fs.readFileSync(filePath, 'utf8');
              credentialObj = JSON.parse(fileContent) as ServiceAccount;
              this.logger.log(`Firebase Admin initialized with key file at ${filePath}`);
              break;
            } catch (fileErr) {
              this.logger.warn(`Failed to read Firebase key file at ${filePath}:`, fileErr);
            }
          }
        }
      }

      if (!credentialObj && clientEmail && privateKey) {
        const formattedKey = privateKey.replace(/\\n/g, '\n');
        credentialObj = {
          projectId,
          clientEmail,
          privateKey: formattedKey,
        };
        this.logger.log(`Firebase Admin initialized with clientEmail credentials for ${projectId}`);
      }

      if (credentialObj) {
        this.app = initializeApp({
          credential: cert(credentialObj),
          projectId,
        });
        this.logger.log(`Firebase Admin SDK successfully initialized for project: ${projectId}`);
      } else {
        this.isMockMode = true;
        this.logger.warn(
          '[FirebaseAdminService] No Firebase credentials found in environment. Running in mock mode (push notifications will be logged, not sent).',
        );
      }
    } catch (err: any) {
      this.isMockMode = true;
      this.logger.error('[FirebaseAdminService] Initialization error (falling back to mock mode):', err?.message);
    }
  }

  isReady(): boolean {
    return !this.isMockMode && this.app !== null;
  }

  /**
   * Sends a push notification to a single native FCM device token.
   */
  async sendToDevice(pushToken: string, payload: FcmNotificationPayload): Promise<FcmSendResult> {
    if (!pushToken || typeof pushToken !== 'string') {
      return { success: false, isInvalidToken: true, error: 'Invalid token' };
    }

    if (this.isMockMode || !this.app) {
      this.logger.debug(
        `[FCM Mock] Push to ${pushToken.substring(0, 10)}... | Title: "${payload.title}" | Body: "${payload.body}"`,
      );
      return { success: true, messageId: `mock-msg-${Date.now()}` };
    }

    try {
      const stringifiedData: Record<string, string> = {};
      if (payload.data) {
        for (const [key, value] of Object.entries(payload.data)) {
          stringifiedData[key] = typeof value === 'string' ? value : JSON.stringify(value);
        }
      }

      const message: Message = {
        token: pushToken,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: stringifiedData,
        android: {
          priority: (payload.priority === 'normal' ? 'normal' : 'high') as any,
          notification: {
            channelId: payload.channelId || 'booking_requests',
            sound: 'default',
            priority: (payload.priority === 'normal' ? 'default' : 'max') as any,
            defaultSound: true,
            defaultVibrateTimings: true,
          },
        },
      };

      const messageId = await getMessaging(this.app).send(message);
      this.logger.debug(`[FCM] Successfully sent messageId: ${messageId} to token ${pushToken.substring(0, 10)}...`);
      return { success: true, messageId };
    } catch (error: any) {
      const errorCode = error?.code || error?.errorInfo?.code;
      const isInvalid =
        errorCode === 'messaging/registration-token-not-registered' ||
        errorCode === 'messaging/invalid-registration-token' ||
        errorCode === 'messaging/invalid-argument';

      if (isInvalid) {
        this.logger.warn(`[FCM] Device token is invalid or unregistered: ${pushToken.substring(0, 10)}...`);
      } else {
        this.logger.error(`[FCM] Failed to send push message to token ${pushToken.substring(0, 10)}...:`, error?.message);
      }

      return {
        success: false,
        isInvalidToken: isInvalid,
        error: error?.message || 'FCM send error',
      };
    }
  }

  /**
   * Sends a multicast push notification to multiple native FCM device tokens.
   */
  async sendToMultipleDevices(
    tokens: string[],
    payload: FcmNotificationPayload,
  ): Promise<FcmMulticastResult> {
    if (!tokens || tokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    if (this.isMockMode || !this.app) {
      this.logger.debug(
        `[FCM Mock Multicast] ${tokens.length} recipients | Title: "${payload.title}" | Body: "${payload.body}"`,
      );
      return {
        successCount: tokens.length,
        failureCount: 0,
        invalidTokens: [],
      };
    }

    const invalidTokens: string[] = [];
    let successCount = 0;
    let failureCount = 0;

    const stringifiedData: Record<string, string> = {};
    if (payload.data) {
      for (const [key, value] of Object.entries(payload.data)) {
        stringifiedData[key] = typeof value === 'string' ? value : JSON.stringify(value);
      }
    }

    // FCM multicast limit is 500 per batch
    const batchSize = 500;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batchTokens = tokens.slice(i, i + batchSize);

      const multicastMessage: MulticastMessage = {
        tokens: batchTokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: stringifiedData,
        android: {
          priority: (payload.priority === 'normal' ? 'normal' : 'high') as any,
          notification: {
            channelId: payload.channelId || 'booking_requests',
            sound: 'default',
            priority: (payload.priority === 'normal' ? 'default' : 'max') as any,
            defaultSound: true,
            defaultVibrateTimings: true,
          },
        },
      };

      try {
        const batchResponse = await getMessaging(this.app).sendEachForMulticast(multicastMessage);
        successCount += batchResponse.successCount;
        failureCount += batchResponse.failureCount;

        batchResponse.responses.forEach((resp: SendResponse, idx: number) => {
          if (!resp.success) {
            const errorCode = resp.error?.code;
            if (
              errorCode === 'messaging/registration-token-not-registered' ||
              errorCode === 'messaging/invalid-registration-token'
            ) {
              const deadToken = batchTokens[idx];
              if (deadToken) {
                invalidTokens.push(deadToken);
              }
            }
          }
        });
      } catch (batchErr: any) {
        this.logger.error('[FCM] Multicast batch failed:', batchErr?.message);
        failureCount += batchTokens.length;
      }
    }

    return {
      successCount,
      failureCount,
      invalidTokens,
    };
  }
}
