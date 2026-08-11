import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedSocket } from '../interfaces/realtime.interface';

@Injectable()
export class SocketAuthMiddleware {
  private readonly logger = new Logger(SocketAuthMiddleware.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  public use() {
    return async (socket: AuthenticatedSocket, next: (err?: Error) => void) => {
      try {
        const token = this.extractToken(socket);

        if (!token) {
          this.logger.warn(`[SocketAuthMiddleware] Authentication failed for socket ${socket.id}: No token provided`);
          return next(new Error('Unauthorized: Authentication token is required'));
        }

        const secret = this.configService.get<string>('jwt.accessSecret') || 'default-secret';
        const payload = this.jwtService.verify(token, { secret });

        if (!payload || !payload.sub || !payload.role) {
          this.logger.warn(`[SocketAuthMiddleware] Authentication failed for socket ${socket.id}: Invalid payload`);
          return next(new Error('Unauthorized: Invalid token structure'));
        }

        // Verify user account exists and is active in DB
        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, role: true, isActive: true },
        });

        if (!user || !user.isActive) {
          this.logger.warn(`[SocketAuthMiddleware] Authentication failed for socket ${socket.id}: User ${payload.sub} inactive or not found`);
          return next(new Error('Unauthorized: User account is inactive or no longer exists'));
        }

        // Attach trusted server identity to socket context
        socket.data = {
          ...socket.data,
          user: {
            userId: user.id,
            role: user.role,
            sessionId: payload.sessionId,
          },
        };

        this.logger.log(`[SocketAuthMiddleware] Socket ${socket.id} authenticated successfully for user=${user.id} role=${user.role}`);
        return next();
      } catch (err: any) {
        this.logger.warn(`[SocketAuthMiddleware] JWT verification failed for socket ${socket.id}: ${err.message}`);
        return next(new Error('Unauthorized: Authentication token is invalid or expired'));
      }
    };
  }

  private extractToken(socket: AuthenticatedSocket): string | null {
    // 1. Check handshake.auth.token
    if (socket.handshake.auth && socket.handshake.auth.token) {
      const rawToken = socket.handshake.auth.token;
      return rawToken.startsWith('Bearer ') ? rawToken.slice(7).trim() : rawToken.trim();
    }

    // 2. Check handshake.headers.authorization
    const authHeader = socket.handshake.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }

    // 3. Check handshake.query.token
    if (socket.handshake.query && typeof socket.handshake.query.token === 'string') {
      return socket.handshake.query.token.trim();
    }

    return null;
  }
}
