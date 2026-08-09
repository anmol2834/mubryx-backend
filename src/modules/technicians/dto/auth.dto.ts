import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TechnicianRequestOtpDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;
}

export class TechnicianVerifyOtpDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsOptional()
  @IsString()
  fullName?: string;
}
