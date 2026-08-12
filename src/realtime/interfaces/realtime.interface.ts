import { Socket } from 'socket.io';
import { UserRole } from '../../generated/prisma/client';

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
  sessionId?: string;
}

export interface SocketData {
  user?: AuthenticatedUser;
}

export type AuthenticatedSocket = Socket<any, any, any, SocketData>;

export interface BookingEventPayload {
  bookingId: string;
  bookingNumber: string;
  customerId: string;
  technicianId?: string | null;
  status: string;
  previousStatus?: string | null;
  totalAmount?: number;
  serviceAddress?: {
    label: string;
    completeAddress: string;
    city?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  technician?: {
    id: string;
    fullName?: string | null;
    phone?: string | null;
    profilePhoto?: string | null;
  } | null;
  engineer?: {
    name: string;
    photo: string | null;
    rating: string;
    completedJobs: number;
    distance: string;
    isTopRated: boolean;
  } | null;
  happyCode?: string | null;
  updatedAt: string;
}

export interface TechnicianLocationPayload {
  bookingId: string;
  technicianId: string;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  timestamp: string;
}

export interface NotificationPayload {
  id?: string;
  userId: string;
  title: string;
  body: string;
  type: string;
  data?: Record<string, any>;
  createdAt: string;
}
