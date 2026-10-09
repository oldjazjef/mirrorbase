import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { ConnectionConfig } from '@dbreplicator/db-plugin';
import type { ConnectionTestResult } from '../application/connection.handlers';
import { type Connection, MAX_NAME_LENGTH } from '../domain/connection';

export class ConnectionDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: 'postgres' }) pluginId!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      "The plugin's non-secret settings (see GET /plugins for the fields)",
  })
  config!: ConnectionConfig;
  @ApiProperty({
    type: [String],
    description:
      'Keys of the password fields that have a saved value. The values are never returned.',
  })
  secretKeys!: string[];
  @ApiProperty({ type: String, nullable: true }) dockerName!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastUsedAt!: string | null;

  static from(connection: Connection): ConnectionDto {
    return Object.assign(new ConnectionDto(), {
      ...connection,
      secretKeys: [...connection.secretKeys],
    });
  }
}

export class CreateConnectionDto {
  @ApiProperty({ maxLength: MAX_NAME_LENGTH })
  @IsString()
  @MaxLength(MAX_NAME_LENGTH * 2)
  name!: string;

  @ApiProperty({ example: 'postgres' })
  @IsString()
  pluginId!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  config!: Record<string, unknown>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Password fields by key. Sealed before they are stored.',
  })
  @IsOptional()
  @IsObject()
  secrets?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Docker container this was created from',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  dockerName?: string;
}

export class UpdateConnectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NAME_LENGTH * 2)
  name?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'New passwords. A key that is absent keeps its saved value.',
  })
  @IsOptional()
  @IsObject()
  secrets?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: [String],
    description: 'Password keys to forget',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  clearSecrets?: string[];
}

export class TestConnectionDto {
  @ApiProperty() @IsString() pluginId!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  config!: Record<string, unknown>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  secrets?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Saved connection whose passwords fill the ones left blank',
  })
  @IsOptional()
  @IsString()
  connectionId?: string;

  @ApiPropertyOptional({ enum: ['source', 'target'], default: 'source' })
  @IsOptional()
  @IsIn(['source', 'target'])
  role?: 'source' | 'target';
}

export class TestResultDto {
  @ApiProperty() ok!: boolean;
  @ApiPropertyOptional({ example: 'PostgreSQL 16.4' }) serverVersion?: string;
  @ApiPropertyOptional() message?: string;
  @ApiPropertyOptional({
    description: 'Set when the test could not run (tools missing)',
  })
  code?: string;

  static from(result: ConnectionTestResult): TestResultDto {
    return Object.assign(new TestResultDto(), result);
  }
}

export class DatabaseListDto {
  @ApiProperty({ type: [String] }) databases!: string[];
}
