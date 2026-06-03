import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { AuthorizationAuditService, DenialMeta } from './authorization-audit.service';
import {
  CrossTenantNotFoundException,
  MembershipDeniedException,
  RoleDeniedException,
} from './authorization.exceptions';

type AuthorizationDenial =
  | MembershipDeniedException
  | RoleDeniedException
  | CrossTenantNotFoundException;

/**
 * Exception filter that audits the three typed authorization denials and then
 * returns the ORIGINAL 403/404 response unchanged (Req 11.1, 11.2, 11.4).
 *
 * Flow on `catch`:
 *  1. Read the non-enumerable `meta` off the exception and write exactly one redacted
 *     `AuditLog` row via `recordDenial` (Req 11.1, 11.2, 11.3).
 *  2. Wrap the audit write in try/catch: a failed audit write is logged but MUST NOT
 *     change the outcome and MUST NOT grant access (Req 11.4).
 *  3. Always send the exception's own status + body — byte-identical to what Nest's
 *     default exceptions layer would produce — so a cross-tenant 404 stays
 *     indistinguishable from a genuine not-found and no resource data leaks
 *     (Req 9.3, 9.4, 9.5, 11.4).
 *
 * Registered globally via `APP_FILTER` after `AllExceptionsFilter` in task 6.1; this
 * file only defines the filter (Phase 1 foundation).
 */
@Catch(
  MembershipDeniedException,
  RoleDeniedException,
  CrossTenantNotFoundException,
)
export class AuthorizationAuditFilter implements ExceptionFilter {
  private readonly logger = new Logger(AuthorizationAuditFilter.name);

  constructor(
    private readonly audit: AuthorizationAuditService,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  async catch(exception: AuthorizationDenial, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    // The distinguishing metadata lives only on the non-enumerable `meta`; it is read
    // here for the audit and never serialized into the response (Req 9.3, 11.3).
    const meta = exception.meta as DenialMeta;

    try {
      await this.audit.recordDenial(meta, request);
    } catch (err) {
      // A failed audit write must not change the outcome nor grant access (Req 11.4).
      this.logger.error(
        `Failed to write authorization denial audit log (${meta?.outcome}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Always send the ORIGINAL rejection response: same status + body the exception
    // would normally produce, with no resource data added (Req 11.4, 9.4).
    const { httpAdapter } = this.httpAdapterHost;
    httpAdapter.reply(response, exception.getResponse(), exception.getStatus());
  }
}
