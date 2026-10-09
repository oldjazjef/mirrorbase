import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  DatabasePlugin,
  FieldDescriptor,
  FieldType,
  LocalizedText,
  TransferPlan,
} from '@mirrorbase/db-plugin';

class LocalizedTextDto {
  @ApiProperty() en!: string;
  @ApiPropertyOptional({ name: 'de-CH' }) 'de-CH'?: string;
}

class FieldOptionDto {
  @ApiProperty() value!: string;
  @ApiProperty({ type: LocalizedTextDto }) label!: LocalizedText;
}

export class FieldDescriptorDto {
  @ApiProperty() key!: string;
  @ApiProperty({
    enum: ['text', 'number', 'password', 'path', 'select', 'boolean'],
  })
  type!: FieldType;
  @ApiProperty({ type: LocalizedTextDto }) label!: LocalizedText;
  @ApiPropertyOptional({ type: LocalizedTextDto }) help?: LocalizedText;
  @ApiPropertyOptional() placeholder?: string;
  @ApiPropertyOptional() required?: boolean;
  @ApiPropertyOptional({
    description: 'Stored sealed; never returned by the API',
  })
  secret?: boolean;
  @ApiPropertyOptional() default?: string | number | boolean;
  @ApiPropertyOptional({ type: [FieldOptionDto] }) options?: FieldOptionDto[];
  @ApiPropertyOptional() min?: number;
  @ApiPropertyOptional() max?: number;
  @ApiPropertyOptional() advanced?: boolean;
}

class CapabilitiesDto {
  @ApiProperty() canBeSource!: boolean;
  @ApiProperty() canBeTarget!: boolean;
  @ApiProperty() multipleDatabases!: boolean;
  @ApiProperty() dockerDiscovery!: boolean;
}

export class PluginDto {
  @ApiProperty({ example: 'postgres' }) id!: string;
  @ApiProperty({ example: 'PostgreSQL' }) name!: string;
  @ApiProperty({ type: LocalizedTextDto }) description!: LocalizedText;
  @ApiProperty() version!: string;
  @ApiProperty({ description: 'Icon name in the UI icon set' }) icon!: string;
  @ApiProperty({ type: CapabilitiesDto }) capabilities!: CapabilitiesDto;
  @ApiProperty({ type: [FieldDescriptorDto] }) fields!: FieldDescriptorDto[];
  @ApiProperty({
    description: 'Native dump format; equal formats copy into each other',
  })
  dumpFormat!: string;

  static from(plugin: DatabasePlugin): PluginDto {
    return Object.assign(new PluginDto(), {
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      icon: plugin.icon,
      capabilities: { ...plugin.capabilities },
      fields: plugin.connectionFields.map(toFieldDto),
      dumpFormat: plugin.dumpFormat,
    });
  }
}

/** Without `pattern`: regexes are for the server; the browser shows what the server says. */
function toFieldDto(field: FieldDescriptor): FieldDescriptorDto {
  const { pattern: _pattern, ...rest } = field;
  return rest as FieldDescriptorDto;
}

export class TransferPlanDto {
  @ApiProperty({ enum: ['native', 'interchange', 'unsupported'] })
  kind!: TransferPlan['kind'];
  @ApiPropertyOptional({
    enum: [
      'sourceCannotBeSource',
      'targetCannotBeTarget',
      'crossEngineUnavailable',
    ],
  })
  reason?: string;

  static from(plan: TransferPlan): TransferPlanDto {
    return Object.assign(new TransferPlanDto(), {
      kind: plan.kind,
      ...(plan.kind === 'unsupported' ? { reason: plan.reason } : {}),
    });
  }
}
