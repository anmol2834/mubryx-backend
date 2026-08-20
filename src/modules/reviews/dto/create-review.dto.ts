import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Min, Max, IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ description: 'Star rating from 1 to 5', example: 5, minimum: 1, maximum: 5 })
  @IsInt({ message: 'Rating must be an integer' })
  @Min(1, { message: 'Rating must be at least 1 star' })
  @Max(5, { message: 'Rating cannot exceed 5 stars' })
  rating!: number;

  @ApiProperty({ description: 'Review text/comment', example: 'Excellent service! Very professional and on time.' })
  @IsString({ message: 'Comment must be a string' })
  @IsNotEmpty({ message: 'Review comment cannot be empty' })
  comment!: string;

  @ApiPropertyOptional({ description: 'Pre-built suggested review text selected by user', example: 'Excellent service! Very professional and on time.' })
  @IsOptional()
  @IsString()
  suggestion?: string;
}
