import { Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { AuthorizationModule } from '../auth/authorization/authorization.module';

@Module({
  imports: [AuthorizationModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
