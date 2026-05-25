import * as dotenv from 'dotenv';
import { startPublishWorker } from './queue/publish.worker';
dotenv.config();

async function bootstrap() {
  console.log('🚀 Auto-Post Background Worker is starting...');
  
  // Khởi động BullMQ Worker
  startPublishWorker();
  
  console.log('📦 Listening to post publishing queue (BullMQ/Redis)...');
}

bootstrap().catch(err => {
  console.error('💥 Worker bootstrap failed:', err);
  process.exit(1);
});
