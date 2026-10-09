import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  DATABASE_STATUSES,
  type DatabaseStatus,
  RUN_STATUSES,
  type Run,
  type RunDatabase,
  type RunStatus,
  type RunStrategy,
} from '../domain/run';

export class RunDatabaseDto {
  @ApiProperty() source!: string;
  @ApiProperty() target!: string;
  @ApiProperty({ enum: DATABASE_STATUSES }) status!: DatabaseStatus;
  @ApiProperty({ type: Number, nullable: true }) bytes!: number | null;
  @ApiProperty() warnings!: number;
  @ApiProperty({ type: String, nullable: true }) errorCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) error!: string | null;

  static from(database: RunDatabase): RunDatabaseDto {
    return Object.assign(new RunDatabaseDto(), database);
  }
}

export class RunDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: RUN_STATUSES }) status!: RunStatus;
  @ApiProperty({ type: String, nullable: true }) sourceConnectionId!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) targetConnectionId!:
    string | null;
  @ApiProperty() sourceName!: string;
  @ApiProperty() targetName!: string;
  @ApiProperty() sourcePluginId!: string;
  @ApiProperty() targetPluginId!: string;
  @ApiProperty({ enum: ['native', 'interchange'] }) strategy!: RunStrategy;
  @ApiProperty() replaceExisting!: boolean;
  @ApiProperty({ type: [RunDatabaseDto] }) databases!: RunDatabaseDto[];
  @ApiProperty({ type: String, nullable: true }) error!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finishedAt!: string | null;

  static from(run: Run): RunDto {
    return Object.assign(new RunDto(), {
      ...run,
      databases: run.databases.map((database) => RunDatabaseDto.from(database)),
    });
  }
}

export class DatabaseSelectionDto {
  @ApiProperty({ description: 'Database on the source' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  source!: string;

  @ApiPropertyOptional({
    description: 'Name on the target; defaults to the source name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  target?: string;
}

export class StartRunDto {
  @ApiProperty({ description: 'Saved connection to copy FROM' })
  @IsString()
  sourceId!: string;

  @ApiProperty({ description: 'Saved connection to copy TO' })
  @IsString()
  targetId!: string;

  @ApiProperty({ type: [DatabaseSelectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DatabaseSelectionDto)
  databases!: DatabaseSelectionDto[];

  @ApiProperty({
    description:
      'Drop a database of the same name on the target first. Only true after the person confirmed it.',
  })
  @IsBoolean()
  replaceExisting!: boolean;
}

export class ListRunsQuery {
  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
