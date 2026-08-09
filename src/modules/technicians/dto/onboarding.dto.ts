import { Gender } from '../../../generated/prisma/client';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateBasicInfoDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsString()
  currentCity?: string;

  @IsOptional()
  @IsString()
  pinCode?: string;

  @IsOptional()
  @IsString()
  bio?: string;
}

export class UpdateSkillsDto {
  @IsArray()
  @IsString({ each: true })
  categoryIds!: string[];
}

export class ExperienceItemDto {
  @IsString()
  companyName!: string;

  @IsString()
  role!: string;

  @IsString()
  startDate!: string;

  @IsString()
  endDate!: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  responsibilities?: string;
}

export class UpdateExperienceDto {
  @IsOptional()
  @IsString()
  totalExperience?: string;

  @IsOptional()
  @IsArray()
  history?: ExperienceItemDto[];
}
