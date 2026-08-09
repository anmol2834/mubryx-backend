import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsISO8601,
  MaxLength,
  ValidateNested,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CustomerCurrentLocationDto {
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;
}

export class CreateBookingDto {
  @IsString()
  @IsNotEmpty()
  addressId!: string;

  @IsEnum(['ASAP', 'SCHEDULED'])
  @IsOptional()
  bookingType?: 'ASAP' | 'SCHEDULED' = 'ASAP';

  /**
   * ISO-8601 datetime string for scheduled bookings.
   * Required when bookingType = 'SCHEDULED'.
   */
  @IsISO8601()
  @IsOptional()
  scheduledAt?: string;

  /**
   * Only CASH_ON_SERVICE is supported in the current release.
   */
  @IsEnum(['CASH_ON_SERVICE'])
  paymentMethod!: 'CASH_ON_SERVICE';

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;

  @IsString()
  @IsOptional()
  couponCode?: string;

  /**
   * Client-generated idempotency key (UUID) to prevent double-booking
   * on network retries. Backend enforces uniqueness at DB level.
   */
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  /**
   * Optional: customer's current GPS device location.
   * SEPARATE from the service address — used for future ETA / matching.
   */
  @ValidateNested()
  @Type(() => CustomerCurrentLocationDto)
  @IsOptional()
  customerCurrentLocation?: CustomerCurrentLocationDto;
}
