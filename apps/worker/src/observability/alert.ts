/**
 * Alert sink for Worker_Service (Req 12.5).
 *
 * POSTs a JSON alert payload to ALERT_WEBHOOK_URL when set; when unset it
 * degrades gracefully to an error-level log (no network call). Used to raise an
 * Alert when a Publish_Job is moved to the Dead_Letter_Store. Never throws.
 *
 * Mirrors the api alert helper (the worker project cannot import api source).
 */
import axios from 'axios';
import { log } from './logger';

/** Shape of an alert event sent to the webhook / logged. */
export interface AlertPayload {
  type: string;
  message: string;
  [key: string]: unknown;
}

/**
 * Send an alert. POSTs JSON to ALERT_WEBHOOK_URL when configured; otherwise
 * logs at error level. Never throws.
 */
export async function sendAlert(payload: AlertPayload): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  const body = { ...payload, timestamp: new Date().toISOString() };

  if (!url) {
    // No webhook configured → degrade to an error log. (graceful degrade)
    log.error(body, `[ALERT:${payload.type}] ${payload.message}`);
    return;
  }

  try {
    await axios.post(url, body, { timeout: 5000 });
  } catch (err) {
    log.error(`Failed to POST alert to webhook: ${(err as Error).message}`);
  }
}
