import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { planTransfer } from '@dbreplicator/db-plugin';
import { UNLOCK_SCHEME } from '../openapi/security-schemes';
import { PluginDto, TransferPlanDto } from './dto/plugin.dto';
import { PluginRegistry } from './plugin-registry';

class TransferPlanQuery {
  @IsString() source!: string;
  @IsString() target!: string;
}

@ApiTags('plugins')
@ApiSecurity(UNLOCK_SCHEME)
@Controller('plugins')
export class PluginsController {
  constructor(private readonly registry: PluginRegistry) {}

  @Get()
  @ApiOperation({
    summary:
      'The installed database plugins and the connection fields each declares',
    description:
      'The app draws its connection forms from `fields`, so a new database type needs no change in the web app.',
  })
  @ApiOkResponse({ type: [PluginDto] })
  list(): PluginDto[] {
    return this.registry.all().map((plugin) => PluginDto.from(plugin));
  }

  @Get('transfer-plan')
  @ApiOperation({ summary: 'How data would get from one plugin to another' })
  @ApiOkResponse({ type: TransferPlanDto })
  plan(@Query() query: TransferPlanQuery): TransferPlanDto {
    return TransferPlanDto.from(
      planTransfer(
        this.registry.require(query.source),
        this.registry.require(query.target),
      ),
    );
  }
}
