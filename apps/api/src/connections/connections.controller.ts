import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { UNLOCK_SCHEME } from '../openapi/security-schemes';
import {
  ConnectionDto,
  CreateConnectionDto,
  DatabaseListDto,
  TestConnectionDto,
  TestResultDto,
  UpdateConnectionDto,
} from './dto/connection.dto';
import { ConnectionsService } from './connections.service';

@ApiTags('connections')
@ApiSecurity(UNLOCK_SCHEME)
@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get()
  @ApiOperation({ summary: 'Saved connections (passwords are never returned)' })
  @ApiOkResponse({ type: [ConnectionDto] })
  async list(): Promise<ConnectionDto[]> {
    return (await this.connections.list()).map((c) => ConnectionDto.from(c));
  }

  @Post()
  @ApiOperation({
    summary: 'Save a connection; its passwords are sealed with AES-256-GCM',
  })
  @ApiOkResponse({ type: ConnectionDto })
  @ApiConflictResponse({ description: '`nameTaken`, `secretsUnavailable`' })
  @ApiUnprocessableEntityResponse({
    description: '`invalidConnection` + the field problems',
  })
  async create(@Body() dto: CreateConnectionDto): Promise<ConnectionDto> {
    return ConnectionDto.from(await this.connections.create(dto));
  }

  @Post('test')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Test the values of a connection form - saved or not',
    description:
      'Nothing is stored. With `connectionId`, a password left blank uses the saved one.',
  })
  @ApiOkResponse({ type: TestResultDto })
  async test(@Body() dto: TestConnectionDto): Promise<TestResultDto> {
    return TestResultDto.from(await this.connections.test(dto));
  }

  @Get(':id')
  @ApiOperation({ summary: 'One saved connection' })
  @ApiOkResponse({ type: ConnectionDto })
  @ApiNotFoundResponse({ description: '`connectionNotFound`' })
  async get(@Param('id') id: string): Promise<ConnectionDto> {
    return ConnectionDto.from(await this.connections.get(id));
  }

  @Put(':id')
  @ApiOperation({ summary: 'Change a saved connection' })
  @ApiOkResponse({ type: ConnectionDto })
  @ApiNotFoundResponse({ description: '`connectionNotFound`' })
  @ApiConflictResponse({ description: '`nameTaken`' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateConnectionDto,
  ): Promise<ConnectionDto> {
    return ConnectionDto.from(await this.connections.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a saved connection (the log of past runs stays)',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: '`connectionNotFound`' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.connections.remove(id);
  }

  @Post(':id/databases')
  @HttpCode(200)
  @ApiOperation({ summary: 'The databases on a saved connection' })
  @ApiOkResponse({ type: DatabaseListDto })
  @ApiUnprocessableEntityResponse({ description: "The plugin's error code" })
  async databases(@Param('id') id: string): Promise<DatabaseListDto> {
    return { databases: await this.connections.databases(id) };
  }
}
