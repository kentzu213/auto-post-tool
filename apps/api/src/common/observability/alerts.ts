/**
 * Lightweight Alert helper (Req 12.4, 12.5).
 *
 * GUIDING PRINCIPLE — degrade gracefully, no hard provider dependency: when
 * `ALERT_WEBHOOK_URL` is set we POST a small JSON payload to it; when it is
 * unset we simply log the alert at error level. Either way the call is fire-
 * and-forget and never throws, so alerting can never crash a request handler,
 * the worker, or bootstrap.
 *
 * The payload intentionally carries only an alert type, a human message, and
 * non-secret context — callers MUST NOT pass Secret_Values or decrypted tokens
 * in `context` (Req 12.7).
 */

/** Categories of monitored condition that can raise an Alert. */
export type AlertType = 'dead_letter' | 'error_rate';

export interface AlertPayload {
  type: AlertType;
  message: string;
  /** Non-secret structured context (ids, counts, thresholds, timestamps). */
  context?: Record<string, unknown>;
}

/** Short timeout so a slow/unreachable webhook never blocks the caller. */
const ALERT_TIMEOUT_MS = 5000;

/**
 * Send an Alert. POSTs JSON to `ALERT_WEBHOOK_URL` when configured, otherwise
 * logs at error level. Fire-and-forget: resolves once the attempt completes and
 * never rejects.
 */
export async function sendAlert(payload: AlertPayload): Promise<void> {
  const body = {
    ...payload,
    service: 'api',
    timestamp: new Date().toISOString(),
  };

  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl || webhookUrl.trim() === '') {
    // No external sink configured — surface the alert in the logs (error level).
    console.error(`[ALERT] ${payload.type}: ${payload.message}`, body.context ?? {});
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    // Never let alert delivery failure propagate; log and move on.
    console.error(`[ALERT] Failed to deliver ${payload.type} alert: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
