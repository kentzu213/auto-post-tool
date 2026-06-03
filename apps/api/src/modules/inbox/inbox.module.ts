import { Module } from '@nestjs/common';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { InboxIngestionService } from './inbox-ingestion.service';
import { AuthorizationModule } from '../auth/authorization/authorization.module';

@Module({
  imports: [AuthorizationModule],
  controllers: [InboxController],
  providers: [InboxService, InboxIngestionService],
  exports: [InboxService, InboxIngestionService],
})
export class InboxModule {}
