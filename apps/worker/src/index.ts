import * as dotenv from 'dotenv';
import { startPublishWorker } from './queue/publish.worker';
import { loadWorkerConfig } from './config-loader';
import { initSentry } from './observability/sentry';
import { initMetrics } from './observability/metrics';
import { captureException } from './observability/sentry';
dotenv.config();

async function bootstrap() {
  console.log('🚀 Auto-Post Background Worker is starting...');

  // Fail-fast config validation BEFORE connecting to Redis / starting the
  // worker. On any missing or invalid Required_Config_Variable this logs the
  // offending names (never the values) and exits non-zero. (Req 6.1, 6.2, 6.4)
  loadWorkerConfig(process.env);

  // Observability sinks — both no-op when their env var is unset (graceful
  // degrade): Sentry on SENTRY_DSN (Req 12.2), OTLP metrics on
  // OTEL_EXPORTER_OTLP_ENDPOINT (Req 12.3).
  initSentry();
  initMetrics();

  // Khởi động BullMQ Worker
  startPublishWorker();
  
  console.log('📦 Listening to post publishing queue (BullMQ/Redis)...');
}

bootstrap().catch(err => {
  console.error('💥 Worker bootstrap failed:', err);
  // Capture the fatal bootstrap error to Sentry when configured. (Req 12.2)
  captureException(err);
  process.exit(1);
});
