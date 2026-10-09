import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { UNLOCK_SCHEME } from '../openapi/security-schemes';
import { ListLogQuery, LogEntryDto, LogPageDto } from './dto/log.dto';
import { LogService } from './log.service';

@ApiTags('logs')
@ApiSecurity(UNLOCK_SCHEME)
@Controller('logs')
export class LogsController {
  constructor(private readonly log: LogService) {}

  @Get()
  @ApiOperation({
    summary:
      'The log, newest first - or, with `afterId`, everything new since then (polling)',
  })
  @ApiOkResponse({ type: LogPageDto })
  async list(@Query() query: ListLogQuery): Promise<LogPageDto> {
    const entries = await this.log.list({
      ...(query.runId ? { runId: query.runId } : {}),
      ...(query.appOnly === 'true' ? { appOnly: true } : {}),
      ...(query.minLevel ? { minLevel: query.minLevel } : {}),
      ...(query.afterId !== undefined ? { afterId: query.afterId } : {}),
      ...(query.beforeId !== undefined ? { beforeId: query.beforeId } : {}),
      limit: query.limit ?? 200,
    });
    return { items: entries.map((entry) => LogEntryDto.from(entry)) };
  }
}
