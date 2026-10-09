import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import {
  PinClock,
  PinLockState,
  PinSessions,
} from './application/pin-sessions';
import { PIN_HANDLERS, PinPolicy } from './application/pin.handlers';
import { PinLockGuard } from './pin-lock.guard';
import { PinController } from './pin.controller';
import { PinService } from './pin.service';

/**
 * The PIN lock. `PinLockGuard` is bound globally in `app.module.ts`; the unlocked sessions live
 * in `PinSessions`, in memory. The repository ports are bound in the global `PersistenceModule`.
 */
@Module({
  imports: [CqrsModule],
  controllers: [PinController],
  providers: [
    PinService,
    PinClock,
    PinSessions,
    PinLockState,
    PinPolicy,
    PinLockGuard,
    ...PIN_HANDLERS,
  ],
  exports: [PinSessions, PinLockState, PinClock, PinLockGuard],
})
export class PinModule {}
