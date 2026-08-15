import { Global, Module } from '@nestjs/common';
import { CONTROL_STORE, InMemoryControlStore } from './control-store.js';

@Global()
@Module({
  providers: [{ provide: CONTROL_STORE, useClass: InMemoryControlStore }],
  exports: [CONTROL_STORE],
})
export class PersistenceModule {}
