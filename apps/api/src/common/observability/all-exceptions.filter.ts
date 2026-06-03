/**
 * Global exception filter (Req 12.2, 12.4).
 *
 * Catches every exception thrown by a request handler, then:
 *  - records the error to the Sentry sink (no-op unless `SENTRY_DSN` is set);
 *  - feeds the application error-rate metric/alert (`recordApiError`);
 *  - returns the SAME error response Nest's built-in handler would produce, so
 *    observability is purely additive and does not change API behavior.
 *
 * Only unexpected (5xx / non-HttpException) errors are sent to Sentry and the
 * error-rate metric; expected 4xx HttpExceptions (validation, auth, throttling)
 * are normal control flow and are passed through without alerting noise.
 *
 * Uses the injected `HttpServer` (Nest's `httpAdapter`) to write the response,
 * the recommended pattern for a catch-all filter so it works even when the
 * built-in exceptions layer would otherwise handle the response.
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpServer,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { captureError } from './sentry';
import { recordApiError } from './metrics';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapter: HttpServer) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest<{ method?: string; url?: string }>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    // Treat anything that is not a sub-500 HttpException as an unexpected error:
    // record it to the error sink and the error-rate metric. Expected 4xx flow
    // (validation/auth/throttle) is passed through untouched.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      captureError(exception);
      recordApiError();
      this.logger.error(
        `Unhandled error on ${request?.method} ${request?.url}: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
      );
    }

    // Reproduce Nest's default response shape so behavior is unchanged.
    const body = isHttpException
      ? exception.getResponse()
      : { statusCode: status, message: 'Internal server error' };

    this.httpAdapter.reply(response, body, status);
  }
}
