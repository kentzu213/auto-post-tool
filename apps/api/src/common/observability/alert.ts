/**
 * Alert sink for API_Service (Req 12.4, 12.5).
 *
 * Small helper that POSTs a JSON alert payload to ALERT_WEBHOOK_URL when set;
 * when unset it degrades gracefully to an error-level log (no network call), so
 * dev/boot is unaffected. All failures are swallowed so alerting never breaks
 * the request flow.
 */
import axios from 'axios';
import { Logger } from '@nestjs/common';

const logger = new Logger('Alert');

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
    logger.error(`[ALERT:${payload.type}] ${payload.message}`);
    return;
  }

  try {
    await axios.post(url, body, { timeout: 5000 });
  } catch (err) {
    logger.error(`Failed to POST alert to webhook: ${(err as Error).message}`);
  }
}
