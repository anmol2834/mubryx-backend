import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ActorType = 'CUSTOMER' | 'TECHNICIAN' | 'ADMIN';
export type OtpPurpose = 'LOGIN' | 'REGISTRATION' | 'PASSWORD_RESET';

@Injectable()
export class TemplateResolver {
  private readonly logger = new Logger(TemplateResolver.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Resolves the required 2Factor template name based on actor and purpose.
   * Throws an error if the template is not configured.
   */
  resolve(actor: string | ActorType, purpose: string | OtpPurpose): string {
    const internalKey = `${actor.toUpperCase()}_${purpose.toUpperCase()}`;
    const envKey = `TWOFACTOR_TEMPLATE_${internalKey}`;
    
    const templateName = this.configService.get<string>(envKey);

    if (!templateName) {
      this.logger.error(`Missing SMS template configuration for ${internalKey}. Please set ${envKey} in environment variables.`);
      throw new Error(`SMS Template for ${internalKey} is not configured.`);
    }

    return templateName;
  }
}
