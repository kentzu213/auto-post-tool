import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check endpoint cho K8s readiness/liveness probes' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memoryUsage: {
        rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`,
        heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
      },
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness check — xác nhận service đã sẵn sàng nhận traffic' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  ready() {
    // Ở đây có thể check DB connection, Redis connection, etc.
    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  }
}
