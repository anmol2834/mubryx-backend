import { IsString, IsNotEmpty, IsInt, Min, Max, IsOptional } from 'class-validator';

export class AddCartItemDto {
  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  quantity?: number = 1;

  @IsString()
  @IsOptional()
  specialNotes?: string;
}
