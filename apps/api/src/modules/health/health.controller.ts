import {
  Controller,
  Get,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import IORedis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../media/storage.service';
import { Public } from '../auth/decorators/public.decorator';

/** Per-dependency probe timeout — keeps readiness fast and non-blocking. */
const CHECK_TIMEOUT_MS = 2000;

type CheckStatus = 'up' | 'down';

/**
 * Race a promise against a timeout so a hung dependency never blocks the
 * readiness probe. Rejects with a timeout error if `p` does not settle in time.
 */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`check timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

@ApiTags('health')
@Controller()
@SkipThrottle()
export class HealthController implements OnModuleDestroy {
  private readonly logger = new Logger(HealthController.name);
  private readonly redis: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    // Single lazily-connected Redis client reused across readiness probes so we
    // do not leak a connection per request. lazyConnect avoids connecting at
    // construction (and during tests/build); ioredis reconnects automatically.
    this.redis = new IORedis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: CHECK_TIMEOUT_MS,
    });
    // Avoid unhandled 'error' events from background reconnection attempts
    // crashing the process when Redis is down (degrade gracefully).
    this.redis.on('error', (err) => {
      this.logger.warn(`Redis client error: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  @Get('health')
  @Public()
  @ApiOperation({ summary: 'Liveness alias — giữ tương thích với callers cũ' })
  @ApiResponse({ status: 200, description: 'Process is up' })
  check() {
    return this.live();
  }

  @Get('health/live')
  @Public()
  @ApiOperation({ summary: 'Liveness — process còn sống, không kiểm tra dependency' })
  @ApiResponse({ status: 200, description: 'Process is up' })
  live() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health/ready')
  @Public()
  @ApiOperation({ summary: 'Readiness — kiểm tra Postgres, Redis, Object_Storage' })
  @ApiResponse({ status: 200, description: 'All dependencies reachable' })
  @ApiResponse({ status: 503, description: 'One or more dependencies unreachable' })
  async ready() {
    const [postgres, redis, storage] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkStorage(),
    ]);

    const checks = { postgres, redis, storage };
    const allUp = postgres === 'up' && redis === 'up' && storage === 'up';

    if (!allUp) {
      // 503 with the per-dependency breakdown. ServiceUnavailableException sets
      // the HTTP status; the object becomes the response body.
      throw new ServiceUnavailableException({ status: 'not_ready', checks });
    }

    return { status: 'ready', checks };
  }

  @Get('version')
  @Public()
  @ApiOperation({ summary: 'Version_Info — commit SHA và build id của artifact đang chạy' })
  @ApiResponse({ status: 200, description: 'Build metadata' })
  version() {
    return {
      commit: process.env.APP_COMMIT_SHA ?? 'unknown',
      buildId: process.env.APP_BUILD_ID ?? 'unknown',
    };
  }

  /** Postgres readiness via `SELECT 1`. Returns 'down' on any error/timeout. */
  private async checkPostgres(): Promise<CheckStatus> {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, CHECK_TIMEOUT_MS);
      return 'up';
    } catch (err) {
      this.logger.warn(`Postgres readiness check failed: ${(err as Error).message}`);
      return 'down';
    }
  }

  /** Redis readiness via `PING`. Returns 'down' on any error/timeout. */
  private async checkRedis(): Promise<CheckStatus> {
    try {
      const pong = await withTimeout(this.redis.ping(), CHECK_TIMEOUT_MS);
      return pong === 'PONG' ? 'up' : 'down';
    } catch (err) {
      this.logger.warn(`Redis readiness check failed: ${(err as Error).message}`);
      return 'down';
    }
  }

  /** Object_Storage readiness via HeadBucket. Returns 'down' on any error/timeout. */
  private async checkStorage(): Promise<CheckStatus> {
    try {
      await withTimeout(this.storage.checkReady(), CHECK_TIMEOUT_MS);
      return 'up';
    } catch (err) {
      this.logger.warn(`Object_Storage readiness check failed: ${(err as Error).message}`);
      return 'down';
    }
  }
}
