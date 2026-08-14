jest.mock('expo-server-sdk', () => {
  return {
    Expo: jest.fn().mockImplementation(() => ({
      sendPushNotificationsAsync: jest.fn(),
    })),
  };
});

import { Test, TestingModule } from '@nestjs/testing';
import { DispatchService } from './dispatch.service';
import { AssignmentService } from './assignment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletService } from '../wallet/wallet.service';

describe('Multi-Service Technician Matching & Assignment', () => {
  let dispatchService: DispatchService;
  let assignmentService: AssignmentService;
  let prisma: any;
  let realtimeService: any;
  let notificationsService: any;
  let walletService: any;

  beforeEach(async () => {
    prisma = {
      booking: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      bookingItem: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      technicianProfile: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      bookingDispatch: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        // Default: dispatch claim succeeds (count=1). Override in conflict tests.
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      notification: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      bookingStatusHistory: {
        create: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    realtimeService = {
      emitToTechnician: jest.fn(),
      emitBookingEvent: jest.fn(),
      emitNotification: jest.fn(),
    };

    notificationsService = {
      sendBookingRequest: jest.fn(),
      sendBookingUpdate: jest.fn(),
    };

    walletService = {
      validateEligibility: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DispatchService,
        AssignmentService,
        { provide: PrismaService, useValue: prisma },
        { provide: RealtimeService, useValue: realtimeService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: WalletService, useValue: walletService },
      ],
    }).compile();

    dispatchService = module.get<DispatchService>(DispatchService);
    assignmentService = module.get<AssignmentService>(AssignmentService);
  });

  describe('dispatchBooking (Multi-Service Separation)', () => {
    it('should independently dispatch each item to technicians matching that specific category skill', async () => {
      const mockBooking = {
        id: 'booking-1',
        bookingNumber: 'MBX-2026-001',
        status: 'TECHNICIAN_SEARCHING',
        bookingType: 'ASAP',
        scheduledAt: null,
        serviceLatitude: 23.0225,
        serviceLongitude: 72.5714,
        snapshotAddress: '123 Main St',
        snapshotLandmark: 'Near Park',
        snapshotCity: 'Ahmedabad',
        items: [
          {
            id: 'item-ac',
            serviceTitleSnapshot: 'AC Deep Clean',
            categoryNameSnapshot: 'AC Services',
            status: 'TECHNICIAN_SEARCHING',
            quantity: 1,
            unitPrice: 500,
            discount: 0,
            lineTotal: 500,
            service: { categoryId: 'cat-ac' },
          },
          {
            id: 'item-geyser',
            serviceTitleSnapshot: 'Geyser Repair',
            categoryNameSnapshot: 'Geyser Services',
            status: 'TECHNICIAN_SEARCHING',
            quantity: 1,
            unitPrice: 400,
            discount: 0,
            lineTotal: 400,
            service: { categoryId: 'cat-geyser' },
          },
        ],
      };

      prisma.booking.findUnique.mockResolvedValue(mockBooking);

      // Mock technician query:
      // When queried for cat-ac -> return Tech AC
      // When queried for cat-geyser -> return Tech Geyser
      prisma.technicianProfile.findMany.mockImplementation(({ where }: any) => {
        const catId = where.skills?.some?.id;
        if (catId === 'cat-ac') {
          return [
            {
              id: 'tech-ac-id',
              latitude: 23.023,
              longitude: 72.572,
              user: { id: 'user-tech-ac' },
            },
          ];
        }
        if (catId === 'cat-geyser') {
          return [
            {
              id: 'tech-geyser-id',
              latitude: 23.024,
              longitude: 72.573,
              user: { id: 'user-tech-geyser' },
            },
          ];
        }
        return [];
      });

      prisma.bookingDispatch.upsert.mockImplementation(({ create }: any) => ({
        id: `dispatch-${create.bookingItemId}`,
        ...create,
      }));

      await dispatchService.dispatchBooking('booking-1');

      // Verify Tech AC received dispatch for item-ac
      expect(prisma.bookingDispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            bookingItemId_technicianId: {
              bookingItemId: 'item-ac',
              technicianId: 'tech-ac-id',
            },
          },
        }),
      );

      // Verify Tech Geyser received dispatch for item-geyser
      expect(prisma.bookingDispatch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            bookingItemId_technicianId: {
              bookingItemId: 'item-geyser',
              technicianId: 'tech-geyser-id',
            },
          },
        }),
      );

      // Verify Realtime event was emitted to Tech AC with item-ac metadata
      expect(realtimeService.emitToTechnician).toHaveBeenCalledWith(
        'user-tech-ac',
        'booking:incoming',
        expect.objectContaining({
          bookingItemId: 'item-ac',
          serviceSummary: 'AC Deep Clean',
        }),
      );

      // Verify Realtime event was emitted to Tech Geyser with item-geyser metadata
      expect(realtimeService.emitToTechnician).toHaveBeenCalledWith(
        'user-tech-geyser',
        'booking:incoming',
        expect.objectContaining({
          bookingItemId: 'item-geyser',
          serviceSummary: 'Geyser Repair',
        }),
      );
    });
  });

  describe('acceptBooking (Partial & Full Assignment Lifecycle)', () => {
    it('should set status to PARTIALLY_ASSIGNED when one item is accepted and others remain searching', async () => {
      const mockTech = {
        id: 'tech-ac-id',
        userId: 'user-tech-ac',
        user: { id: 'user-tech-ac', name: 'John Tech' },
      };
      prisma.technicianProfile.findUnique.mockResolvedValue(mockTech);

      const mockDispatch = {
        id: 'dispatch-ac',
        bookingId: 'booking-1',
        bookingItemId: 'item-ac',
        technicianId: 'tech-ac-id',
        technician: { id: 'tech-ac-id', user: { id: 'user-tech-ac' } },
        status: 'OFFERED',
      };
      prisma.bookingDispatch.findUnique.mockResolvedValue(mockDispatch);

      const mockItemAc = {
        id: 'item-ac',
        bookingId: 'booking-1',
        serviceTitleSnapshot: 'AC Deep Clean',
        status: 'TECHNICIAN_SEARCHING',
        lineTotal: 500,
        booking: { id: 'booking-1', status: 'TECHNICIAN_SEARCHING' },
      };
      prisma.bookingItem.findUnique.mockResolvedValue(mockItemAc);
      prisma.bookingItem.updateMany.mockResolvedValue({ count: 1 });

      // After acceptance, item-ac is ASSIGNED, but item-geyser is still SEARCHING
      prisma.bookingItem.findMany.mockResolvedValue([
        { id: 'item-ac', status: 'TECHNICIAN_ASSIGNED' },
        { id: 'item-geyser', status: 'TECHNICIAN_SEARCHING' },
      ]);

      prisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        bookingNumber: 'MBX-2026-001',
        customerId: 'cust-1',
        status: 'PARTIALLY_ASSIGNED',
        updatedAt: new Date(),
      });

      prisma.bookingDispatch.findMany.mockResolvedValue([mockDispatch]);

      const result = await assignmentService.acceptBooking('user-tech-ac', 'item-ac');

      // Verify wallet check for item line total
      expect(walletService.validateEligibility).toHaveBeenCalledWith('tech-ac-id', 100, prisma);

      // Verify booking item was updated
      expect(prisma.bookingItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-ac', status: 'TECHNICIAN_SEARCHING' },
          data: expect.objectContaining({
            status: 'TECHNICIAN_ASSIGNED',
            technicianId: 'tech-ac-id',
          }),
        }),
      );

      // Verify booking overall status updated to PARTIALLY_ASSIGNED
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'booking-1' },
          data: expect.objectContaining({
            status: 'PARTIALLY_ASSIGNED',
          }),
        }),
      );

      // Verify customer real-time event was sent
      expect(realtimeService.emitBookingEvent).toHaveBeenCalledWith(
        'booking-1',
        'booking:assigned',
        expect.objectContaining({
          bookingItemId: 'item-ac',
          status: 'PARTIALLY_ASSIGNED',
        }),
      );
    });

    it('should set status to TECHNICIAN_ASSIGNED when all items are accepted', async () => {
      const mockTech = {
        id: 'tech-geyser-id',
        userId: 'user-tech-geyser',
        user: { id: 'user-tech-geyser', name: 'Bob Tech' },
      };
      prisma.technicianProfile.findUnique.mockResolvedValue(mockTech);

      const mockDispatch = {
        id: 'dispatch-geyser',
        bookingId: 'booking-1',
        bookingItemId: 'item-geyser',
        technicianId: 'tech-geyser-id',
        technician: { id: 'tech-geyser-id', user: { id: 'user-tech-geyser' } },
        status: 'OFFERED',
      };
      prisma.bookingDispatch.findUnique.mockResolvedValue(mockDispatch);

      const mockItemGeyser = {
        id: 'item-geyser',
        bookingId: 'booking-1',
        serviceTitleSnapshot: 'Geyser Repair',
        status: 'TECHNICIAN_SEARCHING',
        lineTotal: 400,
        booking: { id: 'booking-1', status: 'PARTIALLY_ASSIGNED' },
      };
      prisma.bookingItem.findUnique.mockResolvedValue(mockItemGeyser);
      prisma.bookingItem.updateMany.mockResolvedValue({ count: 1 });

      // All items now assigned
      prisma.bookingItem.findMany.mockResolvedValue([
        { id: 'item-ac', status: 'TECHNICIAN_ASSIGNED' },
        { id: 'item-geyser', status: 'TECHNICIAN_ASSIGNED' },
      ]);

      prisma.booking.findUnique.mockResolvedValue({
        id: 'booking-1',
        bookingNumber: 'MBX-2026-001',
        customerId: 'cust-1',
        status: 'TECHNICIAN_ASSIGNED',
        updatedAt: new Date(),
      });

      prisma.bookingDispatch.findMany.mockResolvedValue([mockDispatch]);

      await assignmentService.acceptBooking('user-tech-geyser', 'item-geyser');

      // Verify booking overall status updated to TECHNICIAN_ASSIGNED
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'booking-1' },
          data: expect.objectContaining({
            status: 'TECHNICIAN_ASSIGNED',
          }),
        }),
      );
    });
  });

  describe('rejectBooking', () => {
    it('should mark dispatch as REJECTED and emit performance update', async () => {
      prisma.technicianProfile.findUnique.mockResolvedValue({
        id: 'tech-1',
        userId: 'user-tech-1',
        user: { id: 'user-tech-1' },
      });

      prisma.bookingDispatch.findUnique.mockResolvedValue({
        id: 'dispatch-1',
        bookingId: 'booking-1',
        bookingItemId: 'item-1',
        technicianId: 'tech-1',
        status: 'OFFERED',
      });

      const res = await assignmentService.rejectBooking('user-tech-1', 'item-1');
      expect(res).toEqual({ success: true });

      expect(prisma.bookingDispatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dispatch-1' },
          data: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );

      expect(realtimeService.emitToTechnician).toHaveBeenCalledWith(
        'user-tech-1',
        'technician:performance_updated',
        expect.objectContaining({
          triggeredBy: 'booking_rejected',
          bookingItemId: 'item-1',
        }),
      );
    });
  });
});
