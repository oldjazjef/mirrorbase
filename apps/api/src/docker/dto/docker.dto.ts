import { ApiProperty } from '@nestjs/swagger';
import type {
  DockerDatabase,
  DockerDatabases,
} from '../application/docker.handlers';
import type { DockerUnavailableReason } from '../ports/docker.port';

export class DockerDatabaseDto {
  @ApiProperty({ example: 'postgres' }) pluginId!: string;
  @ApiProperty({ example: 'PostgreSQL' }) pluginName!: string;
  @ApiProperty() containerId!: string;
  @ApiProperty() containerName!: string;
  @ApiProperty({ description: 'Suggested connection name' }) name!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Non-secret settings to prefill; the password is never read from the container',
  })
  config!: Record<string, string | number | boolean>;
  @ApiProperty() summary!: string;
  @ApiProperty({ type: String, nullable: true }) savedConnectionId!:
    string | null;

  static from(item: DockerDatabase): DockerDatabaseDto {
    return Object.assign(new DockerDatabaseDto(), {
      ...item,
      config: { ...item.config },
    });
  }
}

export class DockerDatabasesDto {
  @ApiProperty({
    description: 'False when Docker is not installed or not running',
  })
  available!: boolean;
  @ApiProperty({
    enum: ['notInstalled', 'notRunning'],
    nullable: true,
    type: String,
  })
  reason!: DockerUnavailableReason | null;
  @ApiProperty({ type: [DockerDatabaseDto] }) items!: DockerDatabaseDto[];

  static from(result: DockerDatabases): DockerDatabasesDto {
    return Object.assign(new DockerDatabasesDto(), {
      available: result.available,
      reason: result.reason,
      items: result.items.map((item) => DockerDatabaseDto.from(item)),
    });
  }
}
