import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { AuthenticatedSocket, AuthenticatedUser } from '../interfaces/realtime.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRole } from '../../generated/prisma/client';

@Injectable()
export class SocketRoomManagerService {
  private readonly logger = new Logger(SocketRoomManagerService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Room Naming Conventions ────────────────────────────────────────────────

  getUserRoom(userId: string): string {
    return `user:${userId}`;
  }

  getCustomerRoom(customerId: string): string {
    return `customer:${customerId}`;
  }

  getTechnicianRoom(technicianId: string): string {
    return `technician:${technicianId}`;
  }

  getAdminRoom(adminId: string): string {
    return `admin:${adminId}`;
  }

  getRoleRoom(role: UserRole): string {
    return `role:${role}`;
  }

  getBookingRoom(bookingId: string): string {
    return `booking:${bookingId}`;
  }

  // ─── Room Management Logic ─────────────────────────────────────────────────

  /**
   * Joins default authorized rooms upon socket connection based on authenticated user identity.
   */
  async joinDefaultRooms(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.data.user;
    if (!user) {
      this.logger.warn(`Cannot join default rooms for socket ${socket.id}: Unauthenticated`);
      return;
    }

    const roomsToJoin: string[] = [
      this.getUserRoom(user.userId),
      this.getRoleRoom(user.role),
    ];

    if (user.role === UserRole.CUSTOMER) {
      roomsToJoin.push(this.getCustomerRoom(user.userId));
    } else if (user.role === UserRole.TECHNICIAN) {
      roomsToJoin.push(this.getTechnicianRoom(user.userId));
    } else if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) {
      roomsToJoin.push(this.getAdminRoom(user.userId));
    }

    await socket.join(roomsToJoin);
    this.logger.log(`[RoomManager] Socket ${socket.id} (User=${user.userId}) joined default rooms: [${roomsToJoin.join(', ')}]`);
  }

  /**
   * Authorizes and joins a specific booking room.
   */
  async authorizeAndJoinBookingRoom(socket: AuthenticatedSocket, bookingId: string): Promise<boolean> {
    const user = socket.data.user;
    if (!user) return false;

    const isAuthorized = await this.canAccessBooking(user, bookingId);
    if (!isAuthorized) {
      this.logger.warn(`[RoomManager] User ${user.userId} forbidden from joining booking room ${bookingId}`);
      return false;
    }

    const roomName = this.getBookingRoom(bookingId);
    await socket.join(roomName);
    this.logger.log(`[RoomManager] Socket ${socket.id} (User=${user.userId}) joined booking room: ${roomName}`);
    return true;
  }

  /**
   * Leaves a specific booking room.
   */
  async leaveBookingRoom(socket: AuthenticatedSocket, bookingId: string): Promise<void> {
    const roomName = this.getBookingRoom(bookingId);
    await socket.leave(roomName);
    this.logger.log(`[RoomManager] Socket ${socket.id} left booking room: ${roomName}`);
  }

  /**
   * Server-side authorization check for booking access.
   */
  async canAccessBooking(user: AuthenticatedUser, bookingId: string): Promise<boolean> {
    if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { customerId: true, technicianId: true },
    });

    if (!booking) return false;

    if (user.role === UserRole.CUSTOMER && booking.customerId === user.userId) {
      return true;
    }

    if (user.role === UserRole.TECHNICIAN) {
      if (booking.technicianId === user.userId) return true;

      // Technicians can also view bookings currently searching for matching technicians
      const profile = await this.prisma.technicianProfile.findUnique({
        where: { userId: user.userId },
        select: { id: true, onboardingStatus: true },
      });

      if (profile && profile.onboardingStatus === 'APPROVED') {
        return true;
      }
    }

    return false;
  }
}
