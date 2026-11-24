import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller.js';
import { AiModule } from './modules/ai/ai.module.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AiModule],
  controllers: [HealthController],
})
export class AppModule {}
