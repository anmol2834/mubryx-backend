import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { envValidationSchema } from './config/env.validation';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';

import { StorageModule } from './infrastructure/storage/storage.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CartModule } from './modules/cart/cart.module';
import { TechniciansModule } from './modules/technicians/technicians.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { BookingModule } from './modules/booking/booking.module';

import { RealtimeModule } from './realtime/realtime.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { WalletModule } from './modules/wallet/wallet.module';

import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV !== 'production' ? 'debug' : 'info',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),
    PrismaModule,
    RedisModule,
    StorageModule,
    RealtimeModule,
    HealthModule,
    UsersModule,
    AuthModule,
    CatalogModule,
    CartModule,
    TechniciansModule,
    AddressesModule,
    BookingModule,
    NotificationsModule,
    WalletModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})

export class AppModule {}
