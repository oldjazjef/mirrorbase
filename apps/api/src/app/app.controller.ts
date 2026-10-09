import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipAllThrottles } from '../common/throttling/throttling';
import { AllowWhileLocked } from '../pin/pin-lock.guard';
import { BUILD_INFO } from './build-info';
import {
  HealthResponseDto,
  VersionResponseDto,
} from './dto/health-response.dto';

@ApiTags('meta')
@Controller()
export class AppController {
  @AllowWhileLocked()
  @SkipAllThrottles()
  @Get('health')
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Answers while the app is locked. Does not touch the database.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  health(): HealthResponseDto {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: BUILD_INFO.full,
    };
  }

  @AllowWhileLocked()
  @SkipAllThrottles()
  @Get('version')
  @ApiOperation({
    summary: 'Version of this build',
    description:
      '`X.Y.Z+<commit>`, fixed at build time (scripts/build/version.mjs).',
  })
  @ApiOkResponse({ type: VersionResponseDto })
  version(): VersionResponseDto {
    return { ...BUILD_INFO };
  }
}
