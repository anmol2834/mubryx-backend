import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RealtimeService } from './services/realtime.service';
import { SocketAuthMiddleware } from './middleware/socket-auth.middleware';
import { SocketRoomManagerService } from './services/socket-room-manager.service';
import { AuthenticatedSocket, TechnicianLocationPayload } from './interfaces/realtime.interface';
import { RealtimeEventDto } from './dto/realtime-event.dto';
import { REALTIME_EVENTS } from './constants/realtime-events.constant';
import { UserRole } from '../generated/prisma/client';

@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGIN || '*').split(','),
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  pingTimeout: 30000,
  pingInterval: 25000,
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly authMiddleware: SocketAuthMiddleware,
    private readonly roomManager: SocketRoomManagerService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Called once when the Socket.IO server initializes attached to HTTP server.
   */
  afterInit(server: Server): void {
    // 1. Attach auth middleware to handshake lifecycle
    server.use(this.authMiddleware.use());

    // 2. Register active Socket.IO server with RealtimeService
    this.realtimeService.setServer(server);

    this.logger.log('RealtimeGateway initialized successfully attached to HTTP server');
  }

  /**
   * Called upon successful client authentication & connection.
   */
  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    const user = client.data.user;

    if (!user) {
      this.logger.warn(`Unauthenticated client attempt on socket ${client.id}. Disconnecting.`);
      client.disconnect(true);
      return;
    }

    try {
      // Auto-join default user and role rooms
      await this.roomManager.joinDefaultRooms(client);

      // Send connection acknowledgement payload
      const ack = RealtimeEventDto.create('system:connected', {
        socketId: client.id,
        userId: user.userId,
        role: user.role,
        serverTime: new Date().toISOString(),
      });

      client.emit('system:connected', ack);

      this.logger.log(`[RealtimeGateway] Client connected: socketId=${client.id} userId=${user.userId} role=${user.role}`);
    } catch (err: any) {
      this.logger.error(`Error during client connection setup for socket ${client.id}`, err?.stack);
      client.disconnect(true);
    }
  }

  /**
   * Called upon client disconnect.
   */
  handleDisconnect(client: AuthenticatedSocket): void {
    const user = client.data.user;
    this.logger.log(`[RealtimeGateway] Client disconnected: socketId=${client.id} userId=${user?.userId || 'unknown'}`);
  }

  // ─── Socket Message Handlers ────────────────────────────────────────────────

  /**
   * Allows authorized clients to subscribe to updates for a specific booking.
   */
  @SubscribeMessage('booking:join')
  async handleJoinBooking(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { bookingId: string },
  ) {
    if (!data || !data.bookingId) {
      return { success: false, error: 'bookingId is required' };
    }

    const success = await this.roomManager.authorizeAndJoinBookingRoom(client, data.bookingId);
    if (!success) {
      return { success: false, error: 'Forbidden: You are not authorized for this booking' };
    }

    return { success: true, bookingId: data.bookingId };
  }

  /**
   * Allows clients to leave a booking room.
   */
  @SubscribeMessage('booking:leave')
  async handleLeaveBooking(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { bookingId: string },
  ) {
    if (data && data.bookingId) {
      await this.roomManager.leaveBookingRoom(client, data.bookingId);
    }
    return { success: true };
  }

  /**
   * Handles real-time location updates emitted by active technicians.
   */
  @SubscribeMessage('technician:location_update')
  async handleTechnicianLocationUpdate(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { bookingId: string; latitude: number; longitude: number; heading?: number; speed?: number },
  ) {
    const user = client.data.user;

    if (!user || user.role !== UserRole.TECHNICIAN) {
      return { success: false, error: 'Forbidden: Only technicians can transmit location updates' };
    }

    if (!data.bookingId || typeof data.latitude !== 'number' || typeof data.longitude !== 'number') {
      return { success: false, error: 'Invalid location payload format' };
    }

    const isAuthorized = await this.roomManager.canAccessBooking(user, data.bookingId);
    if (!isAuthorized) {
      return { success: false, error: 'Forbidden: You are not assigned to this booking' };
    }

    const payload: TechnicianLocationPayload = {
      bookingId: data.bookingId,
      technicianId: user.userId,
      latitude: data.latitude,
      longitude: data.longitude,
      heading: data.heading,
      speed: data.speed,
      timestamp: new Date().toISOString(),
    };

    this.realtimeService.emitTechnicianLocation(payload);
    return { success: true };
  }

  /**
   * Lightweight connection heartbeat / latency ping.
   */
  @SubscribeMessage('ping')
  handlePing() {
    return { pong: true, timestamp: new Date().toISOString() };
  }
}
