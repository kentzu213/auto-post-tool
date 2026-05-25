import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AIService } from './ai.service';
import { GenerateAiDto, TranslateDto, SentimentDto } from './dto/generate.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('AI Assistant')
@Controller('ai')
export class AIController {
  constructor(private readonly aiService: AIService) {}

  @Post('generate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Sinh caption, hashtag, hook bằng AI (Gemini/OpenAI/Claude)' })
  @ApiResponse({ status: 200, description: 'Sinh nội dung thành công' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực JWT' })
  async generateContent(@Body() dto: GenerateAiDto) {
    return this.aiService.generateContent(dto);
  }

  @Post('translate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Dịch nội dung bài viết sang ngôn ngữ khác (i18n)' })
  @ApiResponse({ status: 200, description: 'Dịch thành công' })
  async translate(@Body() dto: TranslateDto) {
    return this.aiService.translate(dto);
  }

  @Post('sentiment')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Phân tích cảm xúc nội dung (positive/negative/neutral/mixed)' })
  @ApiResponse({ status: 200, description: 'Phân tích thành công' })
  async analyzeSentiment(@Body() dto: SentimentDto) {
    return this.aiService.analyzeSentiment(dto);
  }
}
