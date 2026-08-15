import { Global, Module } from '@nestjs/common';
import { CONTROL_STORE, InMemoryControlStore } from './control-store.js';
import { PrismaControlStore } from './prisma-control-store.js';

@Global()
@Module({
  providers: [
    {
      provide: CONTROL_STORE,
      useFactory: () => {
        const connectionString = process.env.DATABASE_URL;
        const usePrisma =
          process.env.ALPHALAB_PERSISTENCE === 'prisma' || Boolean(connectionString);
        if (usePrisma && !connectionString) {
          throw new Error('DATABASE_URL is required when ALPHALAB_PERSISTENCE=prisma');
        }
        return usePrisma
          ? new PrismaControlStore(connectionString as string)
          : new InMemoryControlStore();
      },
    },
  ],
  exports: [CONTROL_STORE],
})
export class PersistenceModule {}
