import { Global, Module } from '@nestjs/common';
import { LogService } from './log.service';
import { LogsController } from './logs.controller';

/** Global: every slice writes to the log. The repository port is bound in PersistenceModule. */
@Global()
@Module({
  controllers: [LogsController],
  providers: [LogService],
  exports: [LogService],
})
export class LogsModule {}
