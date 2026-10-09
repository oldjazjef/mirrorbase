import {
  Body,
  Controller,
  createParamDecorator,
  type ExecutionContext,
  Get,
  HttpCode,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { UNLOCK_SCHEME } from '../openapi/security-schemes';
import {
  AutoLockDto,
  ForgotPinDto,
  PinResetDto,
  PinStatusDto,
  PinUnlockedDto,
  SetPinDto,
  UnlockDto,
} from './dto/pin.dto';
import { AllowWhileLocked, unlockTokenOf } from './pin-lock.guard';
import { PinService } from './pin.service';

/** The request's unlock token (`x-dbreplicator-unlock`), if any. */
const UnlockToken = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined =>
    unlockTokenOf(
      context.switchToHttp().getRequest<{
        headers: Record<string, string | string[] | undefined>;
      }>(),
    ),
);

/**
 * The PIN lock. Status, unlock, set, lock and "forgot" answer while locked (the PIN handlers
 * check what they need themselves); the auto-lock time needs an unlocked session.
 */
@ApiTags('pin')
@ApiSecurity(UNLOCK_SCHEME)
@Controller('pin')
export class PinController {
  constructor(private readonly pins: PinService) {}

  @Get('status')
  @AllowWhileLocked()
  @ApiOperation({
    summary: 'Is there a PIN, is this session unlocked, how long to wait',
  })
  @ApiOkResponse({ type: PinStatusDto })
  async status(
    @UnlockToken() token: string | undefined,
  ): Promise<PinStatusDto> {
    return PinStatusDto.from(await this.pins.status(token));
  }

  @Post('unlock')
  @HttpCode(200)
  @AllowWhileLocked()
  @ApiOperation({
    summary: 'Unlock with the PIN → a short-lived unlock token (sliding)',
  })
  @ApiOkResponse({ type: PinUnlockedDto })
  @ApiUnprocessableEntityResponse({ description: '`wrongPin` + the wait' })
  @ApiTooManyRequestsResponse({ description: '`pinThrottled`: wait first' })
  async unlock(@Body() dto: UnlockDto): Promise<PinUnlockedDto> {
    return PinUnlockedDto.from(await this.pins.unlock(dto.pin));
  }

  @Post('lock')
  @HttpCode(204)
  @AllowWhileLocked()
  @ApiOperation({ summary: 'Lock this session (ends its unlock token)' })
  @ApiNoContentResponse()
  async lock(@UnlockToken() token: string | undefined): Promise<void> {
    await this.pins.lock(token);
  }

  @Post('renew')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Activity without data requests: keeps the session unlocked',
  })
  @ApiOkResponse({ type: PinStatusDto })
  async renew(@UnlockToken() token: string | undefined): Promise<PinStatusDto> {
    return PinStatusDto.from(await this.pins.status(token));
  }

  @Put()
  @AllowWhileLocked()
  @ApiOperation({
    summary: 'Set the first PIN, or change it (current PIN required); unlocks',
  })
  @ApiOkResponse({ type: PinUnlockedDto })
  @ApiBadRequestResponse({ description: '`invalidPin`, `currentPinRequired`' })
  async set(@Body() dto: SetPinDto): Promise<PinUnlockedDto> {
    return PinUnlockedDto.from(
      await this.pins.set(dto.pin, dto.currentPin, dto.autoLockMinutes),
    );
  }

  @Put('auto-lock')
  @ApiOperation({ summary: 'Minutes without activity before the app locks' })
  @ApiOkResponse({ type: PinStatusDto })
  async autoLock(
    @Body() dto: AutoLockDto,
    @UnlockToken() token: string | undefined,
  ): Promise<PinStatusDto> {
    return PinStatusDto.from(await this.pins.autoLock(dto.minutes, token));
  }

  @Post('forgot')
  @HttpCode(200)
  @AllowWhileLocked()
  @ApiOperation({
    summary:
      'PIN forgotten: remove the PIN and erase every saved password (confirm)',
  })
  @ApiOkResponse({ type: PinResetDto })
  @ApiBadRequestResponse({ description: '`confirmationRequired`' })
  async forgot(@Body() dto: ForgotPinDto): Promise<PinResetDto> {
    return PinResetDto.from(await this.pins.forgot(dto.confirmEraseSecrets));
  }
}
