import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import { DomainError } from '@alphalab/domain';
import type { Response } from 'express';
import { ZodError } from 'zod';

const conflictCodes = new Set([
  'STATE_VERSION_CONFLICT',
  'NO_STATE_CHANGE',
  'APPROVAL_ALREADY_CONSUMED',
  'IDEMPOTENCY_CONFLICT',
]);
const forbiddenCodes = new Set([
  'ACTOR_NOT_AUTHORIZED',
  'APPROVAL_REQUIRED',
  'HUMAN_APPROVAL_REQUIRED',
]);

@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      const status = conflictCodes.has(exception.code)
        ? HttpStatus.CONFLICT
        : forbiddenCodes.has(exception.code)
          ? HttpStatus.FORBIDDEN
          : HttpStatus.UNPROCESSABLE_ENTITY;
      response.status(status).json({
        statusCode: status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      });
      return;
    }
    if (exception instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'REQUEST_VALIDATION_FAILED',
        message: 'The request does not match the versioned API contract.',
        issues: exception.issues,
      });
      return;
    }
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'The control plane could not complete the request.',
    });
  }
}
