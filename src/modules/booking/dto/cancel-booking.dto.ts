import { IsString, IsOptional, MaxLength } from 'class-validator';

export class CancelBookingDto {
  @IsString()
  @IsOptional()
  @MaxLength(300)
  reason?: string;
}
