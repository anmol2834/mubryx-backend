# Mubryx Global Real-Time Communication Architecture (Socket.IO)

This document provides complete developer documentation for the Mubryx backend global real-time infrastructure.

---

## 1. System Architecture Map

```
                          MUBRYX BACKEND
                                |
        +-----------------------+-----------------------+
        |                       |                       |
    REST API                SERVICES                 DATABASE
        |                       |                   (PostgreSQL)
        |                       | (After DB Commit)
        |                REALTIME EVENT
        |                       |
        |                       ↓
        |                REALTIME SERVICE
        |                       |
        |                       ↓
        |               REALTIME GATEWAY
        |                  (Socket.IO)
        |                       |
   +----+-----------------------+-----------------------+----+
   |                            |                            |
CUSTOMER                   TECHNICIAN                      ADMIN
App (React Native)       Dashboard (React Native/Web)    Dashboard (Web)
```

### Core Principles
1. **Database is the Authoritative Source of Truth**: State transitions occur inside ACID database transactions (`prisma.$transaction`). Real-time events are emitted **only after** transactions commit.
2. **REST API Functionality**: REST APIs remain 100% functional even if WebSockets are disconnected.
3. **Decoupled Business Services**: Business services (`BookingService`, `TechniciansService`, etc.) inject `RealtimeService` and emit domain events without coupling to Socket.IO internals.
4. **Server-Authoritative Room Access**: Sockets cannot join arbitrary room names. Rooms are joined strictly via server-side authorization.

---

## 2. Authentication & Connection Lifecycle

Clients establish connection using standard Socket.IO client v4+.

### Client Connection Code Example (React Native / Web)
```typescript
import { io } from 'socket.io-client';

const socket = io('http://api.mubryx.com', {
  transports: ['websocket', 'polling'],
  auth: {
    token: 'Bearer YOUR_JWT_ACCESS_TOKEN',
  },
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

socket.on('connect', () => {
  console.log('Connected to Mubryx Realtime, socketId:', socket.id);
});

socket.on('system:connected', (envelope) => {
  console.log('Server Connection Ack:', envelope);
});

socket.on('connect_error', (err) => {
  console.error('Socket Auth Failed:', err.message);
});
```

### Authentication Mechanics
- Socket.IO handshake parses JWT from `socket.handshake.auth.token` or `socket.handshake.headers.authorization`.
- Verifies signature against `jwt.accessSecret`.
- Verifies user exists and is `isActive: true` in the database.
- Attaches trusted server identity to `socket.data.user = { userId, role, sessionId }`.

---

## 3. Server-Controlled Room Strategy

| Room Pattern | Access Permission | Description |
| :--- | :--- | :--- |
| `user:{userId}` | Joined automatically on connection | Target room for all active sockets of a specific user across devices |
| `customer:{userId}` | Joined automatically if role = `CUSTOMER` | Private customer alert channel |
| `technician:{userId}` | Joined automatically if role = `TECHNICIAN` | Private technician alert & job dispatch channel |
| `admin:{userId}` | Joined automatically if role = `ADMIN`/`SUPER_ADMIN` | Private admin alert channel |
| `role:{role}` | Joined automatically based on user role | Broadcast channel for role-wide alerts (e.g. `role:ADMIN`, `role:TECHNICIAN`) |
| `booking:{bookingId}` | Authorized via `booking:join` event | Dynamically authorized room for customer, assigned technician, and monitoring admins |

---

## 4. Standardized Event Envelope

All real-time events emitted by the server wrap data in a predictable, tamper-proof envelope:

```typescript
{
  "eventId": "clx123abc456def789",      // Unique CUID for client deduplication
  "event": "booking:accepted",          // Event name
  "timestamp": "2026-08-10T14:00:00Z",  // ISO 8601 string timestamp
  "data": {                             // Event payload
    "bookingId": "c012345",
    "bookingNumber": "MBX-20260810-12345",
    "status": "TECHNICIAN_ACCEPTED",
    "technician": {
      "id": "tech_999",
      "fullName": "Rahul Sharma"
    }
  }
}
```

---

## 5. Event Catalogue

### Booking Lifecycle Events
- **`booking:created`**: Emitted to `role:ADMIN` and eligible technician rooms when a new booking is created.
- **`booking:assigned`**: Emitted to `booking:{bookingId}` and assigned technician room.
- **`booking:accepted`**: Emitted to `customer:{customerId}`, `booking:{bookingId}`, and `role:ADMIN` when a technician accepts a booking.
- **`booking:status_changed`**: Emitted to `booking:{bookingId}` whenever status transitions (e.g., `TECHNICIAN_ON_THE_WAY`, `ARRIVED`, `SERVICE_STARTED`).
- **`booking:completed`**: Emitted when service and payment are completed.
- **`booking:cancelled`**: Emitted when a booking is cancelled.

### Technician Events
- **`technician:status_updated`**: Status changes (`AVAILABLE`, `BUSY`, `OFFLINE`).
- **`technician:location_updated`**: Live GPS coordinates transmitted during active service delivery.

---

## 6. Frontend TanStack Query Integration Guide

React Native and Web applications using **TanStack Query** should listen for real-time events to invalidate queries rather than duplicating state:

```typescript
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { socket } from './socket';

export function useRealtimeBookingSync(bookingId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    // 1. Join booking room
    socket.emit('booking:join', { bookingId });

    // 2. Handle real-time updates by invalidating TanStack query cache
    const handleStatusUpdate = (envelope) => {
      console.log('Realtime update received:', envelope);
      queryClient.invalidateQueries({ queryKey: ['booking', bookingId] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    };

    socket.on('booking:status_changed', handleStatusUpdate);
    socket.on('booking:accepted', handleStatusUpdate);
    socket.on('booking:cancelled', handleStatusUpdate);

    return () => {
      socket.off('booking:status_changed', handleStatusUpdate);
      socket.off('booking:accepted', handleStatusUpdate);
      socket.off('booking:cancelled', handleStatusUpdate);
      socket.emit('booking:leave', { bookingId });
    };
  }, [bookingId, queryClient]);
}
```

---

## 7. Horizontal Scaling with Redis Adapter

For multi-instance cluster deployments (e.g. AWS ECS, Kubernetes, Render), Socket.IO can seamlessly synchronize events across processes using `@socket.io/redis-adapter`:

```typescript
import { createAdapter } from '@socket.io/redis-adapter';

// Bind to existing RedisService pub/sub client when running in multi-node mode
const pubClient = redisService.getClient();
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));
```
Because `RealtimeService` abstracts emission calls, business services require **zero code changes** when enabling Redis adapter for multi-instance production deployments.
