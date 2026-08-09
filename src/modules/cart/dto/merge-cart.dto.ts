import { IsArray, ValidateNested, IsString, IsNotEmpty, IsInt, Min, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class GuestCartItemDto {
  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number = 1;

  @IsString()
  @IsOptional()
  specialNotes?: string;
}

export class MergeCartDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuestCartItemDto)
  items!: GuestCartItemDto[];
}
