const fs = require('fs');
const path = require('path');

// 1. Frontend notificationService.ts
const frontendPath = 'C:/technician-dashboard/src/services/notifications/notificationService.ts';
const frontendContent = `import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth.store';
import {
  DeviceTokenRegistrationPayload,
  DeviceTokenRegistrationResponse,
  NotificationPermissionStatus,
} from '@/types/notifications';
import { getExpoNotifications, isExpoGo } from './safeNotifications';

// Configure foreground presentation behavior safely.
const initialNotifications = getExpoNotifications();
if (initialNotifications && typeof initialNotifications.setNotificationHandler === 'function') {
  try {
    initialNotifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        priority: (initialNotifications.AndroidNotificationPriority?.MAX ?? 2) as any,
      } as any),
    });
  } catch (err) {
    console.warn('[Notifications] Could not set foreground notification handler:', err);
  }
}

class NotificationService {
  private isInitialized = false;
  private isInitializing = false;
  private lastRegisteredToken: string | null = null;
  private lastRegisteredUserId: string | null = null;
  private lastRegisteredAt = 0;
  private registerPromise: Promise<boolean> | null = null;
  private tokenSubscription: any = null;
  private receivedSubscription: any = null;
  private responseSubscription: any = null;

  /**
   * Configures high-importance Android notification channels for job requests & updates.
   */
  async createChannels(): Promise<void> {
    if (Platform.OS !== 'android') return;

    const Notifications = getExpoNotifications();
    if (!Notifications || typeof Notifications.setNotificationChannelAsync !== 'function') {
      return;
    }

    try {
      // 1. Critical Booking Requests Channel
      await Notifications.setNotificationChannelAsync('booking_requests', {
        name: 'Mubryx Job Requests',
        description: 'Instant alerts for nearby incoming service and booking requests',
        importance: Notifications.AndroidImportance?.MAX ?? 5,
        vibrationPattern: [0, 500, 200, 500, 200, 500],
        lightColor: '#208AEF',
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
        showBadge: true,
        bypassDnd: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility?.PUBLIC ?? 1,
      });

      // 2. Booking Lifecycle Updates Channel
      await Notifications.setNotificationChannelAsync('booking_updates', {
        name: 'Mubryx Booking Updates',
        description: 'Updates on accepted jobs, assignment status, and customer notes',
        importance: Notifications.AndroidImportance?.HIGH ?? 4,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#208AEF',
        sound: 'default',
        enableVibrate: true,
        showBadge: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility?.PUBLIC ?? 1,
      });

      console.log('[Notifications] Android notification channels configured');
    } catch (err) {
      console.warn('[Notifications] Failed to configure Android notification channels:', err);
    }
  }

  /**
   * Checks and requests push notification permissions.
   */
  async requestPermission(): Promise<NotificationPermissionStatus> {
    const Notifications = getExpoNotifications();
    if (!Notifications || typeof Notifications.getPermissionsAsync !== 'function') {
      if (isExpoGo) {
        console.log('[Notifications] Skipping permission request in Expo Go');
      }
      return 'undetermined';
    }

    try {
      const { status: existingStatus, canAskAgain } = await Notifications.getPermissionsAsync();
      if (existingStatus === 'granted') {
        return 'granted';
      }

      if (!canAskAgain) {
        return 'blocked';
      }

      const { status: newStatus } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });

      if (newStatus === 'granted') {
        console.log('[Notifications] Push notification permission granted');
        return 'granted';
      }

      console.log('[Notifications] Push notification permission denied:', newStatus);
      return 'denied';
    } catch (err) {
      console.warn('[Notifications] Permission check/request error:', err);
      return 'undetermined';
    }
  }

  /**
   * Retrieves the native FCM device token on Android.
   */
  async getFCMToken(): Promise<string | null> {
    const Notifications = getExpoNotifications();
    if (!Notifications || typeof Notifications.getDevicePushTokenAsync !== 'function') {
      if (isExpoGo) {
        console.log('[Notifications] Native FCM device token is not available in Expo Go');
      }
      return null;
    }

    try {
      if (!Device.isDevice) {
        console.log('[Notifications] Physical device required for native FCM device token');
        return null;
      }

      const deviceTokenResult = await Notifications.getDevicePushTokenAsync();
      const token = deviceTokenResult?.data;

      if (!token) {
        console.warn('[Notifications] No native device push token returned');
        return null;
      }

      return token;
    } catch (err: any) {
      console.warn('[Notifications] Failed to retrieve native FCM token:', err?.message || err);
      return null;
    }
  }

  /**
   * Registers the native FCM token with the backend for the currently authenticated technician.
   * Fully thread-safe, debounced, and idempotent.
   */
  async registerDeviceToken(userId?: string): Promise<boolean> {
    if (isExpoGo) {
      return false;
    }

    // Return existing in-flight registration if already executing
    if (this.registerPromise) {
      return this.registerPromise;
    }

    const authState = useAuthStore.getState();
    const token = authState.token;
    const currentUserId = userId || authState.user?.id;

    if (!token || !currentUserId) {
      return false;
    }

    this.registerPromise = (async () => {
      try {
        const permission = await this.requestPermission();
        if (permission !== 'granted') {
          return false;
        }

        const fcmToken = await this.getFCMToken();
        if (!fcmToken) {
          return false;
        }

        // Idempotency check: token, userId, and cooldown
        const now = Date.now();
        if (
          this.lastRegisteredToken === fcmToken &&
          this.lastRegisteredUserId === currentUserId &&
          now - this.lastRegisteredAt < 300000 // 5 minutes cooldown for identical token
        ) {
          return true;
        }

        const payload: DeviceTokenRegistrationPayload = {
          pushToken: fcmToken,
          deviceId: Device.osBuildId || Device.modelName || 'android-device',
          platform: Platform.OS as 'android' | 'ios' | 'web',
          appVersion: Constants.expoConfig?.version ?? '1.0.0',
        };

        console.log('[Notifications] Registering native FCM token with backend...');
        const response = await apiClient.post<DeviceTokenRegistrationResponse>(
          '/notifications/devices',
          payload
        );

        if (response.data?.success !== false) {
          this.lastRegisteredToken = fcmToken;
          this.lastRegisteredUserId = currentUserId;
          this.lastRegisteredAt = Date.now();
          console.log('[Notifications] FCM token successfully registered with backend');
          return true;
        } else {
          console.warn('[Notifications] Backend responded with non-success:', response.data?.message);
          return false;
        }
      } catch (err: any) {
        console.error('[Notifications] Failed to register FCM token with backend:', err?.message || err);
        return false;
      } finally {
        this.registerPromise = null;
      }
    })();

    return this.registerPromise;
  }

  /**
   * Deactivates the device token upon technician logout.
   */
  async deactivateDeviceToken(): Promise<void> {
    try {
      const token = this.lastRegisteredToken;
      const deviceId = Device.osBuildId || Device.modelName || 'android-device';

      if (token) {
        console.log('[Notifications] Deactivating device token on backend...');
        await apiClient.post('/notifications/devices/deactivate', {
          pushToken: token,
          deviceId,
        }).catch((err) => {
          console.warn('[Notifications] Deactivate call failed (ignoring for clean logout):', err?.message);
        });
      }
    } catch (err) {
      console.warn('[Notifications] Error during token deactivation:', err);
    } finally {
      this.lastRegisteredToken = null;
      this.lastRegisteredUserId = null;
      this.lastRegisteredAt = 0;
      this.isInitialized = false;
    }
  }

  /**
   * Centralizes notification event listeners.
   */
  setupNotificationListeners(handlers: {
    onNotificationReceived?: (notification: any) => void;
    onNotificationResponse?: (response: any) => void;
  }): () => void {
    const Notifications = getExpoNotifications();
    if (!Notifications) {
      return () => {};
    }

    try {
      if (this.receivedSubscription && typeof this.receivedSubscription.remove === 'function') {
        this.receivedSubscription.remove();
      }
      if (this.responseSubscription && typeof this.responseSubscription.remove === 'function') {
        this.responseSubscription.remove();
      }

      if (handlers.onNotificationReceived && typeof Notifications.addNotificationReceivedListener === 'function') {
        this.receivedSubscription = Notifications.addNotificationReceivedListener(
          handlers.onNotificationReceived
        );
      }

      if (handlers.onNotificationResponse && typeof Notifications.addNotificationResponseReceivedListener === 'function') {
        this.responseSubscription = Notifications.addNotificationResponseReceivedListener(
          handlers.onNotificationResponse
        );
      }
    } catch (err) {
      console.warn('[Notifications] Failed to attach notification listeners:', err);
    }

    return () => {
      if (this.receivedSubscription && typeof this.receivedSubscription.remove === 'function') {
        this.receivedSubscription.remove();
        this.receivedSubscription = null;
      }
      if (this.responseSubscription && typeof this.responseSubscription.remove === 'function') {
        this.responseSubscription.remove();
        this.responseSubscription = null;
      }
    };
  }

  /**
   * Initializes notification channels, permissions, token registration, and token refresh listener.
   * Safe to call multiple times (idempotent singleton).
   */
  async initialize(userId?: string): Promise<boolean> {
    const authState = useAuthStore.getState();
    const currentUserId = userId || authState.user?.id;

    // Singleton guard: do not re-initialize if already done for this user session
    if (this.isInitialized && this.lastRegisteredUserId === currentUserId && this.lastRegisteredToken) {
      return true;
    }

    if (this.isInitializing) {
      return false;
    }

    this.isInitializing = true;

    try {
      console.log('[Notifications] Initializing notification subsystem...');
      await this.createChannels();

      const registered = await this.registerDeviceToken(currentUserId);

      const Notifications = getExpoNotifications();
      // Listen for genuine token refresh by OS
      if (!this.tokenSubscription && Notifications && typeof Notifications.addPushTokenListener === 'function') {
        try {
          this.tokenSubscription = Notifications.addPushTokenListener((newTokenEvent: any) => {
            const newToken = typeof newTokenEvent === 'string' ? newTokenEvent : newTokenEvent?.data;
            if (!newToken || newToken === this.lastRegisteredToken) {
              return; // Token did not change, skip
            }
            console.log('[Notifications] FCM push token updated by OS');
            this.registerDeviceToken(currentUserId);
          });
        } catch (subErr) {
          console.warn('[Notifications] Could not attach token refresh listener:', subErr);
        }
      }

      this.isInitialized = true;
      console.log('[Notifications] Notification subsystem initialized successfully');
      return registered;
    } catch (err) {
      console.error('[Notifications] Error during notification initialization:', err);
      return false;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Cleanup all listeners on unmount.
   */
  cleanup(): void {
    if (this.tokenSubscription && typeof this.tokenSubscription.remove === 'function') {
      this.tokenSubscription.remove();
      this.tokenSubscription = null;
    }
    if (this.receivedSubscription && typeof this.receivedSubscription.remove === 'function') {
      this.receivedSubscription.remove();
      this.receivedSubscription = null;
    }
    if (this.responseSubscription && typeof this.responseSubscription.remove === 'function') {
      this.responseSubscription.remove();
      this.responseSubscription = null;
    }
    this.isInitialized = false;
  }
}

export const notificationService = new NotificationService();
`;
fs.writeFileSync(frontendPath, frontendContent, 'utf8');
console.log('Successfully updated frontend notificationService.ts');
