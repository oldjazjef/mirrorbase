import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { ConnectionConfig } from '@mirrorbase/db-plugin';
import type { ConnectionTestResult } from '../application/connection.handlers';
import type { ImportResult } from '../application/connection-transfer.handlers';
import {
  type Connection,
  MAX_GROUP_LENGTH,
  MAX_NAME_LENGTH,
} from '../domain/connection';

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
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The group the connection is listed under, null when ungrouped',
  })
  group!: string | null;
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

  @ApiPropertyOptional({ maxLength: MAX_GROUP_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_GROUP_LENGTH * 2)
  group?: string;
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

  @ApiPropertyOptional({
    maxLength: MAX_GROUP_LENGTH,
    description: 'The group; an empty string removes the connection from it',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_GROUP_LENGTH * 2)
  group?: string;
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

export class ExportConnectionsDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Connections to export; every connection when omitted',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  ids?: string[];

  @ApiPropertyOptional({
    description: 'Put the saved passwords into the file. Needs a password.',
  })
  @IsOptional()
  @IsBoolean()
  includePasswords?: boolean;

  @ApiPropertyOptional({
    description:
      'Encrypts the whole file (AES-256-GCM, key from scrypt). At least 8 characters.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;
}

export class ImportConnectionsDto {
  @ApiProperty({ description: 'The text of an export file' })
  @IsString()
  @MaxLength(5_000_000)
  content!: string;

  @ApiPropertyOptional({ description: 'The password of an encrypted export' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;
}

export class ImportResultDto {
  @ApiProperty() imported!: number;
  @ApiProperty({
    description: 'Of the imported, renamed because the name was taken',
  })
  renamed!: number;
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: { name: { type: 'string' }, reason: { type: 'string' } },
    },
  })
  skipped!: { name: string; reason: string }[];

  static from(result: ImportResult): ImportResultDto {
    return Object.assign(new ImportResultDto(), {
      ...result,
      skipped: [...result.skipped],
    });
  }
}

export class DatabaseListDto {
  @ApiProperty({ type: [String] }) databases!: string[];
}
