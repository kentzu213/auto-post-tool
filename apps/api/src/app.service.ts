import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): { status: string; message: string } {
    return {
      status: 'healthy',
      message: 'Welcome to Multi-Platform Auto-Posting API Server!'
    };
  }
}
