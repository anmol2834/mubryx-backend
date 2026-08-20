export class SmsProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class SmsConfigurationError extends SmsProviderError {}
export class SmsTimeoutError extends SmsProviderError {}
export class SmsRateLimitError extends SmsProviderError {}
export class SmsRejectedError extends SmsProviderError {}
export class SmsUnavailableError extends SmsProviderError {}
