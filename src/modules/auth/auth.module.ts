import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './services/otp.service';
import { TokenService } from './services/token.service';
import { TemplateResolver } from './services/template.resolver';
import { OTP_PROVIDER } from './providers/otp.provider.interface';
import { DevelopmentOtpProvider } from './providers/development-otp.provider';
import { TwoFactorOtpProvider } from './providers/twofactor-otp.provider';
import { Msg91OtpProvider } from './providers/msg91-otp.provider';
import { ShreeSmsOtpProvider } from './providers/shreesms-otp.provider';
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
    TemplateResolver,
    JwtStrategy,
    TwoFactorOtpProvider,
    Msg91OtpProvider,
    ShreeSmsOtpProvider,
    DevelopmentOtpProvider,
    {
      provide: OTP_PROVIDER,
      useFactory: (
        configService: ConfigService,
        twoFactorOtpProvider: TwoFactorOtpProvider,
        msg91OtpProvider: Msg91OtpProvider,
        shreeSmsOtpProvider: ShreeSmsOtpProvider,
        developmentOtpProvider: DevelopmentOtpProvider,
      ) => {
        const smsProvider = configService.get<string>('SMS_PROVIDER');
        if (smsProvider === 'twofactor') {
          return twoFactorOtpProvider;
        } else if (smsProvider === 'msg91') {
          return msg91OtpProvider;
        } else if (smsProvider === 'shreesms' || smsProvider === 'stpl' || smsProvider === 'smartping') {
          return shreeSmsOtpProvider;
        }
        return developmentOtpProvider;
      },
      inject: [ConfigService, TwoFactorOtpProvider, Msg91OtpProvider, ShreeSmsOtpProvider, DevelopmentOtpProvider],
    },
  ],
  exports: [AuthService, OtpService, TokenService, JwtModule],
})
export class AuthModule {}
