import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeactivateDeviceDto {
  @ApiPropertyOptional({
    description: 'Specific push token to deactivate upon logout',
    example: 'dK3-9_vQ7R8:APA91bF...',
  })
  @IsString()
  @IsOptional()
  @MaxLength(512)
  pushToken?: string;

  @ApiPropertyOptional({
    description: 'Unique device hardware identifier to deactivate all tokens for this device',
    example: 'Pixel 8 Pro (TQ3A.230901.001)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(128)
  deviceId?: string;
}
