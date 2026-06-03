import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthController } from '../auth.controller';
import { SocialAuthController } from '../../social-auth/social-auth.controller';
import { HealthController } from '../../health/health.controller';

/**
 * Task 6.3 — integration test for global auth coverage (Req 1.2, 1.5, 1.6, 9.1).
 *
 * Rather than booting the whole Nest app (DB/Redis), this asserts the two
 * mechanisms that actually determine auth coverage once the guard is registered
 * globally via APP_GUARD:
 *
 *   1. `JwtAuthGuard`'s `@Public()` branch decision: a public route short-circuits
 *      to `true` WITHOUT invoking passport, while a non-public route delegates to
 *      passport (`super.canActivate`) — the path that produces 401 for an
 *      unauthenticated request.
 *   2. The static `@Public()` wiring: exactly the intended public handlers carry
 *      the `IS_PUBLIC_KEY` flag, and protected handlers do not — so every other
 *      route stays behind the global guard (fail-closed).
 */
describe('JwtAuthGuard (global auth coverage)', () => {
  // The parent prototype is where passport's AuthGuard('jwt') defines
  // `canActivate`; `super.canActivate(ctx)` resolves to this method, so spying
  // here intercepts the delegation without invoking real passport.
  const passportProto = Object.getPrototypeOf(JwtAuthGuard.prototype);

  /** Minimal ExecutionContext exposing the handler/class the reflector reads. */
  function makeContext(): {
    ctx: ExecutionContext;
    handler: () => void;
    klass: new () => unknown;
  } {
    const handler = () => undefined;
    class FakeController {}
    const ctx = {
      getHandler: () => handler,
      getClass: () => FakeController,
    } as unknown as ExecutionContext;
    return { ctx, handler, klass: FakeController };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('@Public() branch decision', () => {
    it('returns true synchronously for a public route WITHOUT invoking passport', () => {
      const getAllAndOverride = jest.fn().mockReturnValue(true);
      const reflector = { getAllAndOverride } as any;
      const superSpy = jest.spyOn(passportProto, 'canActivate');

      const guard = new JwtAuthGuard(reflector);
      const { ctx, handler, klass } = makeContext();

      const result = guard.canActivate(ctx);

      // Public route bypasses authentication entirely (Req 1.6 inverse / opt-out).
      expect(result).toBe(true);
      expect(superSpy).not.toHaveBeenCalled();
      // It checks BOTH handler and class metadata, handler taking precedence.
      expect(getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [handler, klass]);
    });

    it('delegates to passport (super.canActivate) for a non-public route', () => {
      const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as any;
      // Sentinel proves the guard returns exactly what passport decides; the real
      // passport would reject an unauthenticated request here with 401 (Req 1.2).
      const sentinel = Symbol('passport-decision');
      const superSpy = jest
        .spyOn(passportProto, 'canActivate')
        .mockReturnValue(sentinel as any);

      const guard = new JwtAuthGuard(reflector);
      const { ctx } = makeContext();

      const result = guard.canActivate(ctx);

      expect(superSpy).toHaveBeenCalledTimes(1);
      expect(superSpy).toHaveBeenCalledWith(ctx);
      expect(result).toBe(sentinel);
    });

    it('delegates to passport when the public flag is absent (undefined metadata)', () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(undefined),
      } as any;
      const superSpy = jest
        .spyOn(passportProto, 'canActivate')
        .mockReturnValue(true as any);

      const guard = new JwtAuthGuard(reflector);
      const { ctx } = makeContext();

      guard.canActivate(ctx);

      // Fail-closed: no explicit @Public() ⇒ still runs passport.
      expect(superSpy).toHaveBeenCalledTimes(1);
    });

    it('is a genuine AuthGuard("jwt") so it owns the passport-jwt entry point', () => {
      // Sanity check that the parent really is a passport AuthGuard mixin, so the
      // delegation above exercises the same path used at runtime.
      expect(JwtAuthGuard.prototype).toBeInstanceOf(AuthGuard('jwt'));
    });
  });

  describe('@Public() static wiring (which routes bypass auth)', () => {
    // Handlers that MUST be public (the only routes allowed to bypass the global
    // JwtAuthGuard) — Req 1.5 enumerates the protected surface; everything else
    // outside this list stays protected.
    const publicHandlers: Array<[string, (...args: any[]) => unknown]> = [
      ['AuthController.register', AuthController.prototype.register],
      ['AuthController.login', AuthController.prototype.login],
      ['AuthController.supabaseSync', AuthController.prototype.supabaseSync],
      ['SocialAuthController.handleCallback', SocialAuthController.prototype.handleCallback],
      ['HealthController.check', HealthController.prototype.check],
      ['HealthController.live', HealthController.prototype.live],
      ['HealthController.ready', HealthController.prototype.ready],
      ['HealthController.version', HealthController.prototype.version],
    ];

    // Representative protected handlers that MUST NOT be public, so the global
    // guard rejects unauthenticated requests with 401 (Req 1.2, 1.5, 9.1).
    const protectedHandlers: Array<[string, (...args: any[]) => unknown]> = [
      ['AuthController.getProfile', AuthController.prototype.getProfile],
      ['SocialAuthController.getAccounts', SocialAuthController.prototype.getAccounts],
      ['SocialAuthController.getConnectUrl', SocialAuthController.prototype.getConnectUrl],
      ['SocialAuthController.directConnect', SocialAuthController.prototype.directConnect],
      ['SocialAuthController.disconnectAccounts', SocialAuthController.prototype.disconnectAccounts],
    ];

    it.each(publicHandlers)('marks %s as @Public()', (_name, handler) => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    });

    it.each(protectedHandlers)('does NOT mark %s as @Public()', (_name, handler) => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeFalsy();
    });
  });
});
