import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './services/otp.service';
import { TokenService } from './services/token.service';
import { OTP_PROVIDER } from './providers/otp.provider.interface';
import { DevelopmentOtpProvider } from './providers/development-otp.provider';
import { JwtStrategy } from '../../common/strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('jwt.accessSecret'),
        signOptions: { expiresIn: config.get('jwt.accessExpiresIn') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    JwtStrategy,
    {
      provide: OTP_PROVIDER,
      useClass: DevelopmentOtpProvider,
    },
  ],
  exports: [AuthService, OtpService, TokenService, JwtModule],
})
export class AuthModule {}
