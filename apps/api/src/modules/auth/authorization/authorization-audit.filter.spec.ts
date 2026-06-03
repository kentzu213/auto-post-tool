import { ArgumentsHost, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { AuthorizationAuditFilter } from './authorization-audit.filter';
import { AuthorizationAuditService } from './authorization-audit.service';
import {
  CrossTenantNotFoundException,
  MembershipDeniedException,
  RoleDeniedException,
} from './authorization.exceptions';

/**
 * Task 4.4 — audit-write resilience (Req 11.4).
 *
 * A failed audit write MUST NOT change the outcome and MUST NOT grant access:
 * the filter still replies with the exception's ORIGINAL status + body and never
 * re-throws. These tests drive the filter directly with hand-built fakes (no Nest
 * DI), so they stay fast and deterministic without a database.
 */
describe('AuthorizationAuditFilter (audit-write resilience)', () => {
  // The three typed denials and the status each must preserve unchanged.
  const cases = [
    {
      name: 'CrossTenantNotFoundException',
      expectedStatus: 404,
      make: () =>
        new CrossTenantNotFoundException('template', 'res-1', 'ws-1', 'user-1'),
    },
    {
      name: 'MembershipDeniedException',
      expectedStatus: 403,
      make: () => new MembershipDeniedException('user-1', 'ws-1'),
    },
    {
      name: 'RoleDeniedException',
      expectedStatus: 403,
      make: () => new RoleDeniedException('user-1', 'ws-1', 'content.create'),
    },
  ] as const;

  // Fakes shared across each test, rebuilt in beforeEach for isolation.
  let reply: jest.Mock;
  let httpAdapterHost: HttpAdapterHost;
  let request: { method: string; url: string };
  let response: { __marker: string };
  let host: ArgumentsHost;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    reply = jest.fn();
    httpAdapterHost = {
      httpAdapter: { reply },
    } as unknown as HttpAdapterHost;

    request = { method: 'POST', url: '/templates' };
    response = { __marker: 'original-response' };

    host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    // Silence the expected error log from the rejected audit write.
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('when the audit write rejects (throws)', () => {
    it.each(cases)(
      'still returns the original $expectedStatus response for $name without re-throwing',
      async ({ expectedStatus, make }) => {
        const recordDenial = jest
          .fn()
          .mockRejectedValue(new Error('audit DB unavailable'));
        const audit = {
          recordDenial,
        } as unknown as AuthorizationAuditService;

        const filter = new AuthorizationAuditFilter(audit, httpAdapterHost);
        const exception = make();
        const expectedBody = exception.getResponse();

        // The handler must not re-throw even though recordDenial rejected.
        await expect(filter.catch(exception, host)).resolves.toBeUndefined();

        // The audit was attempted exactly once...
        expect(recordDenial).toHaveBeenCalledTimes(1);

        // ...and the ORIGINAL rejection is still sent: same response object,
        // the exception's own body, and the unchanged status (no access granted,
        // no resource data added) — Req 11.4.
        expect(reply).toHaveBeenCalledTimes(1);
        expect(reply).toHaveBeenCalledWith(
          response,
          expectedBody,
          exception.getStatus(),
        );
        expect(exception.getStatus()).toBe(expectedStatus);

        // The body carries no resource data — just the generic Nest shape.
        expect(expectedBody).toMatchObject({ statusCode: expectedStatus });
        expect(JSON.stringify(expectedBody)).not.toContain('res-1');

        // The failure was logged (resilience path exercised).
        expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('when the audit write resolves (happy path)', () => {
    it.each(cases)(
      'sends the original $expectedStatus response for $name exactly once',
      async ({ expectedStatus, make }) => {
        const recordDenial = jest.fn().mockResolvedValue(undefined);
        const audit = {
          recordDenial,
        } as unknown as AuthorizationAuditService;

        const filter = new AuthorizationAuditFilter(audit, httpAdapterHost);
        const exception = make();
        const expectedBody = exception.getResponse();

        await expect(filter.catch(exception, host)).resolves.toBeUndefined();

        expect(recordDenial).toHaveBeenCalledTimes(1);
        expect(reply).toHaveBeenCalledTimes(1);
        expect(reply).toHaveBeenCalledWith(
          response,
          expectedBody,
          exception.getStatus(),
        );
        expect(exception.getStatus()).toBe(expectedStatus);

        // No error logged on the happy path.
        expect(loggerErrorSpy).not.toHaveBeenCalled();
      },
    );
  });
});
