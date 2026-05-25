import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';

export const otelSDK = new NodeSDK({
  traceExporter: new ConsoleSpanExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
});

// Graceful shutdown
process.on('SIGTERM', () => {
  otelSDK.shutdown()
    .then(() => console.log('[OTel] SDK shut down successfully'))
    .catch((err) => console.log('[OTel] Error shutting down SDK', err))
    .finally(() => process.exit(0));
});
