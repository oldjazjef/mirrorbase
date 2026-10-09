import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Errors carry a machine-readable `code`; the app translates the code and never shows `message`
 * (which stays English, for logs and API clients).
 */
export function conflict(code: string, message: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code,
    message,
  });
}

export function notFound(code: string, message: string): NotFoundException {
  return new NotFoundException({
    statusCode: 404,
    error: 'Not Found',
    code,
    message,
  });
}

export function badRequest(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code,
    message,
    ...extra,
  });
}

export function unprocessable(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: 422,
    error: 'Unprocessable Entity',
    code,
    message,
    ...extra,
  });
}
