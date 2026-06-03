import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ConsoleSpanExporter, type SpanExporter } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader, type IMetricReader } from '@opentelemetry/sdk-metrics';

/**
 * OpenTelemetry SDK for API_Service (Req 12.3).
 *
 * GUIDING PRINCIPLE — degrade gracefully: every external sink is gated behind
 * `OTEL_EXPORTER_OTLP_ENDPOINT`.
 *   - When the endpoint IS set: traces go to an OTLP/HTTP collector and metrics
 *     (including `app_errors_total` and `publish_job_failures_total`, recorded
 *     via the global meter elsewhere) are exported periodically over OTLP.
 *   - When the endpoint is NOT set (dev default): traces fall back to the
 *     ConsoleSpanExporter and NO metric reader is registered, so the app runs
 *     with no collector and startup never fails on a missing/unreachable
 *     collector.
 *
 * The metric counters themselves are created against the global meter in
 * `common/observability/metrics.ts` (API) — when no MeterProvider/reader is
 * registered here, those `createCounter(...).add(...)` calls resolve to a
 * harmless no-op meter.
 */

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

// Trace exporter: OTLP when an endpoint is configured, else console (dev).
const traceExporter: SpanExporter = otlpEndpoint
  ? new OTLPTraceExporter()
  : new ConsoleSpanExporter();

// Metric reader: only when an OTLP endpoint is configured. Omitting it entirely
// keeps the default (no metrics pipeline) so dev needs no collector.
const metricReaders: IMetricReader[] = otlpEndpoint
  ? [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS ?? 60_000),
      }),
    ]
  : [];

export const otelSDK = new NodeSDK({
  traceExporter,
  ...(metricReaders.length > 0 ? { metricReaders } : {}),
  instrumentations: [getNodeAutoInstrumentations()],
});

// Graceful shutdown
process.on('SIGTERM', () => {
  otelSDK.shutdown()
    .then(() => console.log('[OTel] SDK shut down successfully'))
    .catch((err) => console.log('[OTel] Error shutting down SDK', err))
    .finally(() => process.exit(0));
});
