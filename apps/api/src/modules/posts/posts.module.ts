import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';

@Module({
  imports: [SchedulerModule, AuthorizationModule],
  controllers: [PostsController],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
