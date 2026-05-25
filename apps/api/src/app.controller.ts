import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('General')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'API Server health check' })
  getHello(): { status: string; message: string } {
    return this.appService.getHello();
  }

  @Get('privacy')
  @ApiOperation({ summary: 'Privacy Policy' })
  getPrivacy(): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Privacy Policy - AutoPost</title>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #1e293b; background: #f8fafc; }
          .card { background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
          h1 { color: #6366f1; margin-top: 0; }
          h2 { color: #334155; margin-top: 24px; font-size: 1.25rem; }
          p { color: #475569; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Privacy Policy</h1>
          <p>This Privacy Policy describes how AutoPost collects, uses, and protects your information when you use our local automated posting services.</p>
          <h2>1. Information We Collect</h2>
          <p>We only collect the information necessary to provide and improve our auto-posting services, including oauth tokens and channel identifiers that you explicitly connect.</p>
          <h2>2. Data Security & Protection</h2>
          <p>All access tokens are encrypted locally using enterprise-grade AES-256-GCM encryption before being stored in our database. We do not store original raw tokens.</p>
          <h2>3. Third-Party Platforms</h2>
          <p>Our application integrates with Facebook, YouTube, and TikTok APIs. By using our application, you agree to comply with the developer terms and privacy policies of these third-party platforms.</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;">
          <p style="font-size: 12px; color: #94a3b8;">Last updated: May 2026</p>
        </div>
      </body>
      </html>
    `;
  }

  @Get('terms')
  @ApiOperation({ summary: 'Terms of Service' })
  getTerms(): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Terms of Service - AutoPost</title>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #1e293b; background: #f8fafc; }
          .card { background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
          h1 { color: #6366f1; margin-top: 0; }
          h2 { color: #334155; margin-top: 24px; font-size: 1.25rem; }
          p { color: #475569; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Terms of Service</h1>
          <p>By accessing or using the AutoPost services, you agree to be bound by these Terms of Service.</p>
          <h2>1. Acceptable Use</h2>
          <p>You agree not to use the services to publish spam, prohibited content, or violate the developer terms of service of Facebook, YouTube, or TikTok.</p>
          <h2>2. Local Hosting & Security</h2>
          <p>You are solely responsible for maintaining the security of your local deployment and access credentials.</p>
          <h2>3. Liability Disclaimer</h2>
          <p>Our software is provided "as is" without warranty of any kind. We are not liable for any account suspensions or posting failures on third-party platforms.</p>
          <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;">
          <p style="font-size: 12px; color: #94a3b8;">Last updated: May 2026</p>
        </div>
      </body>
      </html>
    `;
  }
}
