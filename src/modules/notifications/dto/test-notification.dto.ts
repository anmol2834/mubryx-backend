import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class TestNotificationDto {
  @ApiPropertyOptional({
    description: 'Custom notification title',
    example: 'Mubryx Test',
    default: 'Mubryx Test',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({
    description: 'Custom notification message body',
    example: 'FCM push notification is working.',
    default: 'FCM push notification is working.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  body?: string;

  @ApiPropertyOptional({
    description: 'Optional custom key-value payload data',
    example: { type: 'test', timestamp: '2026-08-14T12:00:00Z' },
  })
  @IsOptional()
  data?: Record<string, any>;
}
