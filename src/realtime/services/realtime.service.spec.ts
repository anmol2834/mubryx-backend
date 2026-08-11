import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeService } from './realtime.service';
import { SocketRoomManagerService } from './socket-room-manager.service';
import { REALTIME_EVENTS } from '../constants/realtime-events.constant';
import { UserRole } from '../../generated/prisma/client';

describe('RealtimeService', () => {
  let service: RealtimeService;
  let roomManager: SocketRoomManagerService;
  let mockServer: any;

  beforeEach(async () => {
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeService,
        {
          provide: SocketRoomManagerService,
          useValue: {
            getUserRoom: (id: string) => `user:${id}`,
            getCustomerRoom: (id: string) => `customer:${id}`,
            getTechnicianRoom: (id: string) => `technician:${id}`,
            getAdminRoom: (id: string) => `admin:${id}`,
            getRoleRoom: (role: string) => `role:${role}`,
            getBookingRoom: (id: string) => `booking:${id}`,
          },
        },
      ],
    }).compile();

    service = module.get<RealtimeService>(RealtimeService);
    roomManager = module.get<SocketRoomManagerService>(SocketRoomManagerService);
    service.setServer(mockServer as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should attach server instance', () => {
    expect(service.getServer()).toBe(mockServer);
  });

  it('should emit event to user room', () => {
    const userId = 'user_123';
    const payload = { test: true };

    service.emitToUser(userId, REALTIME_EVENTS.SYSTEM.ALERT, payload);

    expect(mockServer.to).toHaveBeenCalledWith('user:user_123');
    expect(mockServer.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.SYSTEM.ALERT,
      expect.objectContaining({
        event: REALTIME_EVENTS.SYSTEM.ALERT,
        data: payload,
        eventId: expect.any(String),
        timestamp: expect.any(String),
      }),
    );
  });

  it('should emit booking lifecycle events', () => {
    const bookingPayload = {
      bookingId: 'book_1',
      bookingNumber: 'MBX-2026-100',
      customerId: 'cust_1',
      technicianId: 'tech_1',
      status: 'TECHNICIAN_ACCEPTED',
      updatedAt: new Date().toISOString(),
    };

    service.emitBookingEvent('book_1', REALTIME_EVENTS.BOOKING.ACCEPTED, bookingPayload);

    expect(mockServer.to).toHaveBeenCalledWith('booking:book_1');
    expect(mockServer.to).toHaveBeenCalledWith('customer:cust_1');
    expect(mockServer.to).toHaveBeenCalledWith('technician:tech_1');
    expect(mockServer.to).toHaveBeenCalledWith('role:ADMIN');
    expect(mockServer.to).toHaveBeenCalledWith('role:SUPER_ADMIN');
  });

  it('should emit notification payload', () => {
    const notification = {
      userId: 'cust_1',
      title: 'Booking Confirmed',
      body: 'Your technician has accepted the job.',
      type: 'BOOKING',
      createdAt: new Date().toISOString(),
    };

    service.emitNotification('cust_1', notification);

    expect(mockServer.to).toHaveBeenCalledWith('user:cust_1');
    expect(mockServer.emit).toHaveBeenCalledWith(
      REALTIME_EVENTS.NOTIFICATION.CREATED,
      expect.objectContaining({
        data: notification,
      }),
    );
  });
});
