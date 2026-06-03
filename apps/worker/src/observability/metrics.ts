/**
 * Worker metrics (Req 12.3).
 *
 * Records the Publish_Job failure count as an OpenTelemetry counter. A
 * MeterProvider with an OTLP/HTTP metric exporter is registered ONLY when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set; otherwise no provider is registered and
 * the global meter is a no-op — so the worker boots fine without a collector
 * and metric calls are cheap no-ops.
 *
 * `initMetrics()` must be called once at worker startup before recording.
 */
import { metrics } from '@opentelemetry/api';

let publishJobFailureCounter: ReturnType<
  ReturnType<typeof metrics.getMeter>['createCounter']
> | null = null;

/**
 * Initialize the worker MeterProvider + OTLP exporter when a collector is
 * configured. No-op (and metrics become no-ops) when the endpoint is unset.
 */
export function initMetrics(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (endpoint) {
    // Lazy require so the heavier SDK is only loaded when actually exporting.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');

    const provider = new MeterProvider({
      readers: [
        new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() }),
      ],
    });
    metrics.setGlobalMeterProvider(provider);
  }

  // Resolve the counter from whatever provider is registered (real or no-op).
  publishJobFailureCounter = metrics
    .getMeter('autopost-worker')
    .createCounter('publish_job_failures_total', {
      description: 'Total Publish_Job failures (final / dead-letter)',
    });
}

/** Increment the Publish_Job failure counter by one. Safe no-op pre-init. */
export function recordPublishJobFailure(attrs: { platform?: string } = {}): void {
  try {
    publishJobFailureCounter?.add(1, attrs);
  } catch {
    // Metrics must never break the worker flow.
  }
}
