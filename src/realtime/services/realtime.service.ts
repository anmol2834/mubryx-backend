import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { SocketRoomManagerService } from './socket-room-manager.service';
import { RealtimeEventDto } from '../dto/realtime-event.dto';
import { RealtimeEventName, REALTIME_EVENTS } from '../constants/realtime-events.constant';
import { BookingEventPayload, NotificationPayload, TechnicianLocationPayload } from '../interfaces/realtime.interface';
import { UserRole } from '../../generated/prisma/client';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  constructor(private readonly roomManager: SocketRoomManagerService) {}

  /**
   * Called by RealtimeGateway on initialization to register the active Socket.IO server.
   */
  setServer(server: Server): void {
    this.server = server;
    this.logger.log('Socket.IO server instance attached to RealtimeService');
  }

  getServer(): Server | null {
    return this.server;
  }

  // ─── Direct Emission Methods ────────────────────────────────────────────────

  /**
   * Emits an event to a specific user across all their connected devices.
   */
  emitToUser(userId: string, event: RealtimeEventName, data: any): void {
    const room = this.roomManager.getUserRoom(userId);
    this.emitToRoom(room, event, data);
  }

  /**
   * Emits an event to a specific customer.
   */
  emitToCustomer(customerId: string, event: RealtimeEventName, data: any): void {
    const room = this.roomManager.getCustomerRoom(customerId);
    this.emitToRoom(room, event, data);
  }

  /**
   * Emits an event to a specific technician.
   */
  emitToTechnician(technicianId: string, event: RealtimeEventName, data: any): void {
    const room = this.roomManager.getTechnicianRoom(technicianId);
    this.emitToRoom(room, event, data);
  }

  /**
   * Emits an event to a specific admin.
   */
  emitToAdmin(adminId: string, event: RealtimeEventName, data: any): void {
    const room = this.roomManager.getAdminRoom(adminId);
    this.emitToRoom(room, event, data);
  }

  /**
   * Broadcasts an event to all connected administrators.
   */
  emitToAdmins(event: RealtimeEventName, data: any): void {
    const roomAdmin = this.roomManager.getRoleRoom(UserRole.ADMIN);
    const roomSuperAdmin = this.roomManager.getRoleRoom(UserRole.SUPER_ADMIN);
    this.emitToRoom(roomAdmin, event, data);
    this.emitToRoom(roomSuperAdmin, event, data);
  }

  /**
   * Emits an event to a specific role channel (e.g., TECHNICIAN).
   */
  emitToRole(role: UserRole, event: RealtimeEventName, data: any): void {
    const room = this.roomManager.getRoleRoom(role);
    this.emitToRoom(room, event, data);
  }

  /**
   * Emits an event to all participants of a specific booking.
   */
  emitToBooking(bookingId: string, event: RealtimeEventName, data: any): void {
    const room = this.roomManager.getBookingRoom(bookingId);
    this.emitToRoom(room, event, data);
  }

  // ─── Domain Workflow Emission Helpers ────────────────────────────────────────

  /**
   * Emits booking lifecycle events to customer, assigned technician, booking room, and admins.
   */
  emitBookingEvent(bookingId: string, event: RealtimeEventName, payload: BookingEventPayload): void {
    try {
      const envelope = RealtimeEventDto.create(event, payload);

      // 1. Emit to booking room
      this.emitToBooking(bookingId, event, envelope);

      // 2. Emit to customer room
      if (payload.customerId) {
        this.emitToCustomer(payload.customerId, event, envelope);
      }

      // 3. Emit to technician room if assigned/accepted
      if (payload.technicianId) {
        this.emitToTechnician(payload.technicianId, event, envelope);
      }

      // 4. Emit to admin rooms for real-time dashboard updates
      this.emitToAdmins(event, envelope);

      this.logger.log(`[RealtimeService] Emitted booking event '${event}' for bookingId=${bookingId} (Number=${payload.bookingNumber})`);
    } catch (err: any) {
      this.logger.error(`[RealtimeService] Failed to emit booking event '${event}' for bookingId=${bookingId}`, err?.stack);
    }
  }

  /**
   * Emits real-time notification payload to a targeted user.
   */
  emitNotification(userId: string, notification: NotificationPayload): void {
    try {
      const envelope = RealtimeEventDto.create(REALTIME_EVENTS.NOTIFICATION.CREATED, notification);
      this.emitToUser(userId, REALTIME_EVENTS.NOTIFICATION.CREATED, envelope);
      this.logger.log(`[RealtimeService] Emitted notification to userId=${userId}`);
    } catch (err: any) {
      this.logger.error(`[RealtimeService] Failed to emit notification to userId=${userId}`, err?.stack);
    }
  }

  /**
   * Emits technician live location update to authorized participants of a booking.
   */
  emitTechnicianLocation(payload: TechnicianLocationPayload): void {
    try {
      const envelope = RealtimeEventDto.create(REALTIME_EVENTS.TECHNICIAN.LOCATION_UPDATED, payload);
      this.emitToBooking(payload.bookingId, REALTIME_EVENTS.TECHNICIAN.LOCATION_UPDATED, envelope);
      this.emitToAdmins(REALTIME_EVENTS.TECHNICIAN.LOCATION_UPDATED, envelope);
    } catch (err: any) {
      this.logger.error(`[RealtimeService] Failed to emit technician location for bookingId=${payload.bookingId}`, err?.stack);
    }
  }

  // ─── Internal Transport Execution ──────────────────────────────────────────

  private emitToRoom(room: string, event: string, data: any): void {
    if (!this.server) {
      this.logger.warn(`[RealtimeService] Cannot emit event '${event}' to room '${room}': Socket.IO server not initialized`);
      return;
    }

    try {
      const envelope = data instanceof RealtimeEventDto ? data : RealtimeEventDto.create(event, data);
      this.server.to(room).emit(event, envelope);
    } catch (err: any) {
      this.logger.error(`[RealtimeService] Error emitting event '${event}' to room '${room}'`, err?.stack);
    }
  }
}
