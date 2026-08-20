import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TemplateResolver } from './template.resolver';

describe('TemplateResolver', () => {
  let resolver: TemplateResolver;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateResolver,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const mockEnv: Record<string, string> = {
                'TWOFACTOR_TEMPLATE_CUSTOMER_LOGIN': 'MBX_CUST_LOGIN',
                'TWOFACTOR_TEMPLATE_ADMIN_LOGIN': 'MBX_ADMIN_LOGIN',
                'TWOFACTOR_TEMPLATE_TECHNICIAN_LOGIN': 'MBX_TECH_LOGIN',
              };
              return mockEnv[key];
            }),
          },
        },
      ],
    }).compile();

    resolver = module.get<TemplateResolver>(TemplateResolver);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(resolver).toBeDefined();
  });

  it('should resolve CUSTOMER LOGIN template', () => {
    expect(resolver.resolve('CUSTOMER', 'LOGIN')).toBe('MBX_CUST_LOGIN');
  });

  it('should resolve ADMIN LOGIN template', () => {
    expect(resolver.resolve('ADMIN', 'LOGIN')).toBe('MBX_ADMIN_LOGIN');
  });

  it('should resolve TECHNICIAN LOGIN template', () => {
    expect(resolver.resolve('TECHNICIAN', 'LOGIN')).toBe('MBX_TECH_LOGIN');
  });

  it('should throw an error for unsupported combinations', () => {
    expect(() => resolver.resolve('CUSTOMER', 'REGISTRATION')).toThrow(/not configured/);
  });

  it('should throw an error if configuration is missing entirely', () => {
    jest.spyOn(configService, 'get').mockReturnValue(undefined);
    expect(() => resolver.resolve('CUSTOMER', 'LOGIN')).toThrow(/not configured/);
  });
});
