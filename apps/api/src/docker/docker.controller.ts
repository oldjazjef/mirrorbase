import { Controller, Get } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import {
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { UNLOCK_SCHEME } from '../openapi/security-schemes';
import {
  type DockerDatabases,
  ListDockerDatabasesQuery,
} from './application/docker.handlers';
import { DockerDatabasesDto } from './dto/docker.dto';

@ApiTags('docker')
@ApiSecurity(UNLOCK_SCHEME)
@Controller('docker')
export class DockerController {
  constructor(private readonly queries: QueryBus) {}

  @Get('databases')
  @ApiOperation({
    summary: 'Databases running in Docker containers on this computer',
    description:
      'Each installed plugin says which containers it recognises. Never fails when Docker is missing: `available` is false then.',
  })
  @ApiOkResponse({ type: DockerDatabasesDto })
  async databases(): Promise<DockerDatabasesDto> {
    return DockerDatabasesDto.from(
      await this.queries.execute<ListDockerDatabasesQuery, DockerDatabases>(
        new ListDockerDatabasesQuery(),
      ),
    );
  }
}
