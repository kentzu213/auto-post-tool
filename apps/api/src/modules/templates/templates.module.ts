import { Module } from '@nestjs/common';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { AuthorizationModule } from '../auth/authorization/authorization.module';

@Module({
  imports: [AuthorizationModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
