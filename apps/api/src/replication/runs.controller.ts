import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { UNLOCK_SCHEME } from '../openapi/security-schemes';
import {
  CancelRunCommand,
  GetRunQuery,
  ListRunsQuery as ListRunsMessage,
  StartRunCommand,
} from './application/run.handlers';
import type { Run } from './domain/run';
import { ListRunsQuery, RunDto, StartRunDto } from './dto/run.dto';

@ApiTags('runs')
@ApiSecurity(UNLOCK_SCHEME)
@Controller('runs')
export class RunsController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Start copying databases from one saved connection to another',
    description:
      'Returns at once (202); the run goes on in the background. Poll `GET /runs/{id}` and `GET /logs?runId=`.',
  })
  @ApiOkResponse({ type: RunDto, description: 'The queued run' })
  @ApiConflictResponse({ description: '`runInProgress`' })
  @ApiUnprocessableEntityResponse({
    description: '`transferUnsupported`, `sameDatabase`',
  })
  async start(@Body() dto: StartRunDto): Promise<RunDto> {
    const run = await this.commands.execute<StartRunCommand, Run>(
      new StartRunCommand(
        dto.sourceId,
        dto.targetId,
        dto.databases,
        dto.replaceExisting,
      ),
    );
    return RunDto.from(run);
  }

  @Get()
  @ApiOperation({ summary: 'Past and current runs, newest first' })
  @ApiOkResponse({ type: [RunDto] })
  async list(@Query() query: ListRunsQuery): Promise<RunDto[]> {
    const runs = await this.queries.execute<ListRunsMessage, Run[]>(
      new ListRunsMessage(query.limit ?? 50),
    );
    return runs.map((run) => RunDto.from(run));
  }

  @Get(':id')
  @ApiOperation({ summary: 'One run with the state of each database' })
  @ApiOkResponse({ type: RunDto })
  @ApiNotFoundResponse({ description: '`runNotFound`' })
  async get(@Param('id') id: string): Promise<RunDto> {
    return RunDto.from(
      await this.queries.execute<GetRunQuery, Run>(new GetRunQuery(id)),
    );
  }

  @Post(':id/cancel')
  @HttpCode(202)
  @ApiOperation({ summary: 'Stop a run that is in progress' })
  @ApiOkResponse({ type: RunDto })
  @ApiConflictResponse({ description: '`runNotActive`' })
  async cancel(@Param('id') id: string): Promise<RunDto> {
    return RunDto.from(
      await this.commands.execute<CancelRunCommand, Run>(
        new CancelRunCommand(id),
      ),
    );
  }
}
