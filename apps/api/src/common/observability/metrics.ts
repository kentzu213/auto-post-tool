/**
 * Application metrics + error-rate alerting for API_Service (Req 12.3, 12.4).
 *
 * Two responsibilities, both lightweight and dependency-gated:
 *
 *  1. METRIC (Req 12.3): an `app_errors_total` counter recorded on the global
 *     OpenTelemetry meter. When `otel-sdk.ts` has registered a MeterProvider
 *     with an OTLP metric reader (because `OTEL_EXPORTER_OTLP_ENDPOINT` is set)
 *     the counter is exported; otherwise `metrics.getMeter` returns a no-op
 *     meter and the increment is harmless. The same in-process count is also
 *     kept so the value is observable without a collector.
 *
 *  2. ALERT (Req 12.4): a rolling-window error tracker. Each recorded error is
 *     timestamped; when the number of errors within `ALERT_ERROR_RATE_WINDOW_MS`
 *     exceeds `ALERT_ERROR_RATE_THRESHOLD`, an Alert is raised AT MOST ONCE per
 *     window (a cooldown suppresses repeats until the window elapses).
 *
 * Defaults are sane for dev (a real collector/webhook is optional): threshold
 * 10 errors within a 60s window.
 */
import { metrics, type Counter } from '@opentelemetry/api';
import { sendAlert } from './alerts';

/** Rolling-window length for the error-rate alert. Default 60s. */
const WINDOW_MS = Number(process.env.ALERT_ERROR_RATE_WINDOW_MS ?? 60_000);
/** Error count within the window that triggers an Alert. Default 10. */
const THRESHOLD = Number(process.env.ALERT_ERROR_RATE_THRESHOLD ?? 10);

/** Timestamps (ms) of recent errors, pruned to the rolling window. */
const errorTimestamps: number[] = [];
/** Epoch ms until which further error-rate alerts are suppressed. */
let alertCooldownUntil = 0;
/** Total errors observed since process start (collector-free observability). */
let totalErrors = 0;

let errorCounter: Counter | undefined;

/** Lazily resolve the `app_errors_total` counter from the global meter. */
function getErrorCounter(): Counter {
  if (!errorCounter) {
    errorCounter = metrics.getMeter('api').createCounter('app_errors_total', {
      description: 'Total application errors captured by the global exception filter',
    });
  }
  return errorCounter;
}

/**
 * Record one application error: increments the OTel counter and feeds the
 * rolling-window error-rate alert. Never throws — observability must not mask
 * the original error.
 */
export function recordApiError(): void {
  try {
    totalErrors += 1;
    getErrorCounter().add(1);
    evaluateErrorRate();
  } catch {
    // metrics/alerting failures must never propagate into the request path.
  }
}

/** Prune the window and raise an Alert (once per window) when over threshold. */
function evaluateErrorRate(): void {
  const now = Date.now();
  errorTimestamps.push(now);

  // Drop timestamps outside the rolling window.
  const cutoff = now - WINDOW_MS;
  while (errorTimestamps.length > 0 && errorTimestamps[0] < cutoff) {
    errorTimestamps.shift();
  }

  if (errorTimestamps.length > THRESHOLD && now >= alertCooldownUntil) {
    alertCooldownUntil = now + WINDOW_MS; // at most one alert per window
    void sendAlert({
      type: 'error_rate',
      message: `API error rate exceeded threshold: ${errorTimestamps.length} errors in ${WINDOW_MS}ms (threshold ${THRESHOLD})`,
      context: { count: errorTimestamps.length, windowMs: WINDOW_MS, threshold: THRESHOLD },
    });
  }
}

/** Total errors observed since start (exposed for tests/diagnostics). */
export function getTotalErrors(): number {
  return totalErrors;
}
