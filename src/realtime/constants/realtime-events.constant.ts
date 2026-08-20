/**
 * Centralized, versioned event constants for the global Mubryx real-time communication system.
 * Namespaces enforce clean separation across Booking, Technician, Notification, and System events.
 */
export const REALTIME_EVENTS = {
  // Booking lifecycle events
  BOOKING: {
    CREATED: 'booking:created',
    INCOMING: 'booking:incoming',
    NO_LONGER_AVAILABLE: 'booking:no-longer-available',
    SEARCHING: 'booking:searching',
    ASSIGNED: 'booking:assigned',
    ACCEPTED: 'booking:accepted',
    REJECTED: 'booking:rejected',
    ON_THE_WAY: 'booking:on_the_way',
    ARRIVED: 'booking:arrived',
    SERVICE_STARTED: 'booking:service_started',
    SERVICE_COMPLETED: 'booking:service_completed',
    PAYMENT_UPDATED: 'booking:payment_updated',
    COMPLETED: 'booking:completed',
    CANCELLED: 'booking:cancelled',
    FAILED: 'booking:failed',
    STATUS_CHANGED: 'booking:status_changed',
    REVIEW_REQUESTED: 'booking:review_requested',
    REVIEW_SUBMITTED: 'booking:review_submitted',
    HAPPY_CODE_GENERATED: 'booking:happy_code_generated',
    INVOICE_READY: 'booking:invoice_ready',
  },

  // Technician presence & location tracking
  TECHNICIAN: {
    AVAILABLE: 'technician:available',
    UNAVAILABLE: 'technician:unavailable',
    STATUS_UPDATED: 'technician:status_updated',
    LOCATION_UPDATED: 'technician:location_updated',
    ASSIGNMENT_DISPATCHED: 'technician:assignment_dispatched',
    PERFORMANCE_UPDATED: 'technician:performance_updated',
  },

  // Notification events
  NOTIFICATION: {
    CREATED: 'notification:created',
    READ: 'notification:read',
  },

  // System alert events
  SYSTEM: {
    ALERT: 'system:alert',
    MAINTENANCE: 'system:maintenance',
  },
} as const;

export type RealtimeEventName =
  | (typeof REALTIME_EVENTS.BOOKING)[keyof typeof REALTIME_EVENTS.BOOKING]
  | (typeof REALTIME_EVENTS.TECHNICIAN)[keyof typeof REALTIME_EVENTS.TECHNICIAN]
  | (typeof REALTIME_EVENTS.NOTIFICATION)[keyof typeof REALTIME_EVENTS.NOTIFICATION]
  | (typeof REALTIME_EVENTS.SYSTEM)[keyof typeof REALTIME_EVENTS.SYSTEM];
