import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './services/realtime.service';
import { SocketRoomManagerService } from './services/socket-room-manager.service';
import { SocketAuthMiddleware } from './middleware/socket-auth.middleware';

@Global()
@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.accessSecret') || 'default-secret',
        signOptions: {
          expiresIn: (config.get('jwt.accessExpiresIn') || '15m') as any,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    RealtimeGateway,
    RealtimeService,
    SocketRoomManagerService,
    SocketAuthMiddleware,
  ],
  exports: [RealtimeService, SocketRoomManagerService, RealtimeGateway],
})
export class RealtimeModule {}
