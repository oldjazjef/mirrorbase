import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { LOG_LEVELS, type LogEntry, type LogLevel } from '../domain/log-entry';

export class LogEntryDto {
  @ApiProperty() id!: number;
  @ApiProperty({ type: String, nullable: true }) runId!: string | null;
  @ApiProperty({ enum: LOG_LEVELS }) level!: LogLevel;
  @ApiProperty() message!: string;
  @ApiProperty({ format: 'date-time' }) at!: string;

  static from(entry: LogEntry): LogEntryDto {
    return Object.assign(new LogEntryDto(), entry);
  }
}

export class LogPageDto {
  @ApiProperty({ type: [LogEntryDto] }) items!: LogEntryDto[];
}

export class ListLogQuery {
  @ApiProperty({ required: false, description: 'Only the entries of this run' })
  @IsOptional()
  @IsString()
  runId?: string;

  @ApiProperty({ required: false, description: 'Only entries without a run' })
  @IsOptional()
  @IsIn(['true', 'false'])
  appOnly?: string;

  @ApiProperty({
    required: false,
    enum: LOG_LEVELS,
    description: 'This level and worse',
  })
  @IsOptional()
  @IsIn(LOG_LEVELS)
  minLevel?: LogLevel;

  @ApiProperty({
    required: false,
    description: 'Polling: entries after this id, oldest first',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterId?: number;

  @ApiProperty({
    required: false,
    description: 'Paging: entries before this id, newest first',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeId?: number;

  @ApiProperty({ required: false, default: 200, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}
