import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CampaignsModule } from './campaigns/campaigns.module.js';
import { HealthController } from './health/health.controller.js';
import { PersistenceModule } from './persistence/persistence.module.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PersistenceModule, CampaignsModule],
  controllers: [HealthController],
})
export class AppModule {}
