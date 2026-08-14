import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength, IsIn } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({
    description: 'Native FCM or Expo Push device token',
    example: 'dK3-9_vQ7R8:APA91bF...',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  pushToken!: string;

  @ApiPropertyOptional({
    description: 'Device operating system / platform',
    enum: ['android', 'ios', 'web'],
    default: 'android',
  })
  @IsString()
  @IsOptional()
  @IsIn(['android', 'ios', 'web'])
  platform?: string;

  @ApiPropertyOptional({
    description: 'Unique device hardware/OS model identifier',
    example: 'Pixel 8 Pro (TQ3A.230901.001)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(128)
  deviceId?: string;

  @ApiPropertyOptional({
    description: 'Technician Dashboard application build version',
    example: '1.0.0',
  })
  @IsString()
  @IsOptional()
  @MaxLength(32)
  appVersion?: string;
}
