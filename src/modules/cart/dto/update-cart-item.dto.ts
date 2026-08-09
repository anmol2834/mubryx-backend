import { IsInt, Min, Max, IsOptional } from 'class-validator';

export class UpdateCartItemDto {
  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;

  @IsInt()
  @IsOptional()
  expectedVersion?: number;
}
