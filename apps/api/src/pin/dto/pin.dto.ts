import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import type {
  PinReset,
  PinStatus,
  PinUnlocked,
} from '../application/pin.handlers';
import { AUTO_LOCK_MINUTES } from '../domain/pin';

export class PinStatusDto {
  @ApiProperty({
    description: 'Is a PIN set? Without one the app asks for a new PIN.',
  })
  hasPin!: boolean;
  @ApiProperty() unlocked!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiresAt!: string | null;
  @ApiProperty() autoLockMinutes!: number;
  @ApiProperty() failedAttempts!: number;
  @ApiProperty({ description: 'Seconds to wait before the next attempt' })
  retryAfterSeconds!: number;

  static from(status: PinStatus): PinStatusDto {
    return Object.assign(new PinStatusDto(), status);
  }
}

export class PinUnlockedDto {
  @ApiProperty({ type: PinStatusDto }) status!: PinStatusDto;
  @ApiProperty({
    description: 'Send in `x-mirrorbase-unlock` on every data request',
  })
  token!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;

  static from({ status, unlock }: PinUnlocked): PinUnlockedDto {
    return Object.assign(new PinUnlockedDto(), {
      status: PinStatusDto.from(status),
      token: unlock.token,
      expiresAt: unlock.expiresAt,
    });
  }
}

export class PinResetDto {
  @ApiProperty({ type: PinStatusDto }) status!: PinStatusDto;
  @ApiProperty({ description: 'Connections that lost their saved password' })
  erasedSecrets!: number;

  static from({ status, erasedSecrets }: PinReset): PinResetDto {
    return Object.assign(new PinResetDto(), {
      status: PinStatusDto.from(status),
      erasedSecrets,
    });
  }
}

export class UnlockDto {
  @ApiProperty({ example: '1234' })
  @IsString()
  pin!: string;
}

export class SetPinDto {
  @ApiProperty({ description: '4 to 8 digits', example: '1234' })
  @IsString()
  pin!: string;

  @ApiPropertyOptional({ description: 'Required when a PIN exists already' })
  @IsOptional()
  @IsString()
  currentPin?: string;

  @ApiPropertyOptional({
    minimum: AUTO_LOCK_MINUTES.min,
    maximum: AUTO_LOCK_MINUTES.max,
  })
  @IsOptional()
  @IsInt()
  @Min(AUTO_LOCK_MINUTES.min)
  @Max(AUTO_LOCK_MINUTES.max)
  autoLockMinutes?: number;
}

export class AutoLockDto {
  @ApiProperty({
    minimum: AUTO_LOCK_MINUTES.min,
    maximum: AUTO_LOCK_MINUTES.max,
  })
  @IsInt()
  @Min(AUTO_LOCK_MINUTES.min)
  @Max(AUTO_LOCK_MINUTES.max)
  minutes!: number;
}

export class ForgotPinDto {
  @ApiProperty({
    description: 'Must be true: resetting the PIN erases every saved password',
  })
  @IsBoolean()
  confirmEraseSecrets!: boolean;
}
