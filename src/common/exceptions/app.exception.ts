import { HttpException, HttpStatus } from '@nestjs/common';

export interface AppExceptionDetails {
  field?: string;
  message: string;
}

export class AppException extends HttpException {
  constructor(
    public readonly errorCode: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: AppExceptionDetails[],
  ) {
    super({ errorCode, message, details }, status);
  }
}

export class NotFoundException extends AppException {
  constructor(resource: string) {
    super('RESOURCE_NOT_FOUND', `${resource} not found`, HttpStatus.NOT_FOUND);
  }
}

export class UnauthorizedException extends AppException {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, HttpStatus.UNAUTHORIZED);
  }
}

export class ForbiddenException extends AppException {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, HttpStatus.FORBIDDEN);
  }
}

export class ConflictException extends AppException {
  constructor(message: string) {
    super('CONFLICT', message, HttpStatus.CONFLICT);
  }
}

export class TooManyRequestsException extends AppException {
  constructor(message = 'Too many requests') {
    super('RATE_LIMIT_EXCEEDED', message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
