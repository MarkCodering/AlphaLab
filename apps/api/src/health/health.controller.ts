import { Controller, Get, Version } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  @Version('1')
  health(): Record<string, string> {
    return {
      status: 'ok',
      service: 'alphalab-api',
      contractVersion: '1.0',
    };
  }
}
