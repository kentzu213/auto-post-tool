import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { GenerateAiDto, TranslateDto, SentimentDto } from './dto/generate.dto';

/**
 * AIService — Multi-provider AI content generation engine
 * Providers: Google Gemini, OpenAI GPT-4o, Anthropic Claude
 * Features: Caption generation, i18n translation, sentiment analysis
 */
@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  // ============================================================
  // CONTENT GENERATION
  // ============================================================

  async generateContent(dto: GenerateAiDto): Promise<{
    caption: string;
    hashtags: string[];
    hook: string;
    providerUsed: string;
  }> {
    const provider = dto.provider || 'gemini';
    const lang = dto.lang || 'vi';
    const platform = dto.targetPlatform || 'facebook';

    const systemPrompt = this.buildContentSystemPrompt(lang, platform);
    const userPrompt = `Viết bài đăng thu hút về chủ đề: "${dto.prompt}". Trả về JSON:
{
  "caption": "nội dung bài viết kèm emoji, tối ưu cho ${platform}",
  "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "hook": "câu tiêu đề giật tít 3 giây đầu video"
}`;

    try {
      let result: any = null;
      if (provider === 'gemini') {
        result = await this.callGemini(systemPrompt, userPrompt, 'Content Generation');
      } else if (provider === 'openai') {
        result = await this.callOpenAI(systemPrompt, userPrompt, 'Content Generation');
      } else if (provider === 'claude') {
        result = await this.callClaude(systemPrompt, userPrompt, 'Content Generation');
      }

      if (result && result.caption) {
        return {
          caption: result.caption,
          hashtags: result.hashtags || [],
          hook: result.hook || '',
          providerUsed: this.getProviderLabel(provider),
        };
      }
    } catch (error: any) {
      this.logger.error(`[${provider}] Content gen failed: ${error.message}. Switching to mock.`);
    }

    return this.generateMockContent(dto.prompt, `${provider} (Fallback Mock)`);
  }

  // ============================================================
  // TRANSLATION (i18n)
  // ============================================================

  async translate(dto: TranslateDto): Promise<{
    translated: string;
    sourceLang: string;
    targetLang: string;
    providerUsed: string;
  }> {
    const provider = dto.provider || 'gemini';
    const systemPrompt = `Bạn là dịch giả chuyên nghiệp. Dịch văn bản chính xác, giữ nguyên emoji và hashtags. Chỉ trả về JSON.`;
    const userPrompt = `Dịch đoạn sau sang ${dto.targetLang}${dto.sourceLang ? ` (từ ${dto.sourceLang})` : ''}. Trả về JSON:
{
  "translated": "văn bản đã dịch",
  "sourceLang": "mã ngôn ngữ nguồn (auto-detect nếu không biết)",
  "targetLang": "${dto.targetLang}"
}

Văn bản: "${dto.text}"`;

    try {
      let result: any;
      if (provider === 'gemini') {
        result = await this.callGemini(systemPrompt, userPrompt, 'Translation');
      } else if (provider === 'openai') {
        result = await this.callOpenAI(systemPrompt, userPrompt, 'Translation');
      } else if (provider === 'claude') {
        result = await this.callClaude(systemPrompt, userPrompt, 'Translation');
      }

      if (result) {
        return {
          translated: result.translated || dto.text,
          sourceLang: result.sourceLang || dto.sourceLang || 'auto',
          targetLang: dto.targetLang,
          providerUsed: this.getProviderLabel(provider),
        };
      }
    } catch (error: any) {
      this.logger.error(`[${provider}] Translation failed: ${error.message}`);
    }

    // Fallback mock
    return {
      translated: `[${dto.targetLang.toUpperCase()}] ${dto.text}`,
      sourceLang: dto.sourceLang || 'auto',
      targetLang: dto.targetLang,
      providerUsed: `${provider} (Fallback Mock)`,
    };
  }

  // ============================================================
  // SENTIMENT ANALYSIS
  // ============================================================

  async analyzeSentiment(dto: SentimentDto): Promise<{
    sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
    confidence: number;
    summary: string;
    providerUsed: string;
  }> {
    const provider = dto.provider || 'gemini';
    const systemPrompt = `Bạn là chuyên gia phân tích cảm xúc nội dung mạng xã hội. Chỉ trả về JSON.`;
    const userPrompt = `Phân tích cảm xúc của đoạn văn sau. Trả về JSON:
{
  "sentiment": "positive|negative|neutral|mixed",
  "confidence": 0.0-1.0,
  "summary": "mô tả ngắn gọn cảm xúc"
}

Văn bản: "${dto.text}"`;

    try {
      let result: any;
      if (provider === 'gemini') {
        result = await this.callGemini(systemPrompt, userPrompt, 'Sentiment');
      } else if (provider === 'openai') {
        result = await this.callOpenAI(systemPrompt, userPrompt, 'Sentiment');
      } else if (provider === 'claude') {
        result = await this.callClaude(systemPrompt, userPrompt, 'Sentiment');
      }

      if (result) {
        return {
          sentiment: result.sentiment || 'neutral',
          confidence: typeof result.confidence === 'number' ? result.confidence : 0.85,
          summary: result.summary || 'N/A',
          providerUsed: this.getProviderLabel(provider),
        };
      }
    } catch (error: any) {
      this.logger.error(`[${provider}] Sentiment failed: ${error.message}`);
    }

    // Fallback mock
    return {
      sentiment: 'neutral',
      confidence: 0.7,
      summary: 'Không thể phân tích (mock mode)',
      providerUsed: `${provider} (Fallback Mock)`,
    };
  }

  // ============================================================
  // PROVIDER IMPLEMENTATIONS
  // ============================================================

  /**
   * Google Gemini Pro / Gemini Flash
   */
  private async callGemini(systemPrompt: string, userPrompt: string, task: string): Promise<any> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      this.logger.warn(`[Gemini] No API key — returning null for ${task}`);
      return null;
    }

    this.logger.log(`🤖 [Gemini] Calling API for: ${task}`);

    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
        },
      },
      { timeout: 30000 },
    );

    const textResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResponse) throw new Error('Gemini returned empty response');

    return JSON.parse(textResponse);
  }

  /**
   * OpenAI GPT-4o
   */
  private async callOpenAI(systemPrompt: string, userPrompt: string, task: string): Promise<any> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      this.logger.warn(`[OpenAI] No API key — returning null for ${task}`);
      return null;
    }

    this.logger.log(`🤖 [OpenAI] Calling API for: ${task}`);

    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );

    const textResponse = response.data.choices?.[0]?.message?.content;
    if (!textResponse) throw new Error('OpenAI returned empty response');

    return JSON.parse(textResponse);
  }

  /**
   * Anthropic Claude (Sonnet/Haiku/Opus)
   */
  private async callClaude(systemPrompt: string, userPrompt: string, task: string): Promise<any> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.logger.warn(`[Claude] No API key — returning null for ${task}`);
      return null;
    }

    this.logger.log(`🤖 [Claude] Calling API for: ${task}`);

    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
        ],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );

    const textResponse = response.data.content?.[0]?.text;
    if (!textResponse) throw new Error('Claude returned empty response');

    return JSON.parse(textResponse);
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private buildContentSystemPrompt(lang: string, platform: string): string {
    const langName = lang === 'vi' ? 'Tiếng Việt' : lang === 'en' ? 'English' : lang;

    const platformGuide: Record<string, string> = {
      facebook: 'Tối ưu cho Facebook: caption dài 100-300 từ, emoji tự nhiên, kết thúc bằng CTA. Hashtags 3-5 cái.',
      youtube: 'Tối ưu cho YouTube: title SEO-friendly, description kèm timestamps, hashtags 5-8 cái. Hook giật tít mạnh.',
      tiktok: 'Tối ưu cho TikTok: caption ngắn gọn dưới 150 từ, nhiều emoji, hashtags trending 5-8 cái. Hook 3s cực cuốn.',
    };

    return `Bạn là chuyên gia marketing mạng xã hội hàng đầu thế giới.
Ngôn ngữ: ${langName}.
${platformGuide[platform] || ''}
Bạn bắt buộc phải trả về JSON thuần túy (không bọc trong markdown).`;
  }

  private getProviderLabel(provider: string): string {
    const labels: Record<string, string> = {
      gemini: `Google Gemini (${process.env.GEMINI_MODEL || 'gemini-2.0-flash'})`,
      openai: `OpenAI (${process.env.OPENAI_MODEL || 'gpt-4o'})`,
      claude: `Anthropic Claude (${process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514'})`,
    };
    return labels[provider] || provider;
  }

  /**
   * Mock content generator — used when API keys are missing
   */
  private generateMockContent(prompt: string, providerName: string) {
    const mockCaptions = [
      `🔥 SIÊU PHẨM MỚI! Đánh giá chi tiết về "${prompt}" cực kỳ hot hòn họt! 😍\n\nKiểu dáng sang xịn mịn, tính năng nâng cấp vượt bậc. Chốt đơn ngay! 👇`,
      `💡 Bạn đã biết điều này chưa? Giải pháp đột phá về "${prompt}" vừa hé lộ! 🚀\n\nTối ưu hiệu năng, tiết kiệm chi phí. Tag chiến hữu cùng học hỏi! ⬇️`,
      `🎬 HẬU TRƯỜNG THÚ VỊ! Trải nghiệm thực tế "${prompt}" có gì vui? 😂\n\nXem ngay video để không bỏ lỡ!`,
    ];

    const mockHashtags = ['xuhuong', 'trending', 'autopost', 'ai_assistant', prompt.toLowerCase().replace(/\s+/g, '_').slice(0, 30)];
    const mockHooks = [
      `Dừng lại 3 giây! Bí mật về ${prompt} bạn chưa từng biết!`,
      `Sự thật ngã ngửa về ${prompt}! Có thực sự đáng?`,
      `AI đã thay đổi ${prompt} như thế nào?`,
    ];

    const idx = Math.floor(Math.random() * mockCaptions.length);
    return { caption: mockCaptions[idx], hashtags: mockHashtags, hook: mockHooks[idx], providerUsed: providerName };
  }
}
