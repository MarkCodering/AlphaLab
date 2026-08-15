import 'reflect-metadata';
import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { DomainErrorFilter } from './common/domain-error.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: false });
  app.enableCors({ origin: false });
  app.enableShutdownHooks();
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new DomainErrorFilter());

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('AlphaLab Control Plane')
      .setDescription('Versioned local-first scientific campaign API')
      .setVersion('1.0')
      .build(),
  );
  SwaggerModule.setup('docs', app, document);

  const port = Number.parseInt(process.env.ALPHALAB_API_PORT ?? process.env.PORT ?? '4310', 10);
  const host = process.env.ALPHALAB_API_HOST ?? '127.0.0.1';
  await app.listen(port, host);
  Logger.log(`AlphaLab API listening on ${port}`, 'Bootstrap');
}

void bootstrap();
