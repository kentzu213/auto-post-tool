import { Test, TestingModule } from '@nestjs/testing';
import { AIService } from './ai.service';

describe('AIService', () => {
  let service: AIService;

  beforeEach(async () => {
    // Clear all env vars before each test
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const module: TestingModule = await Test.createTestingModule({
      providers: [AIService],
    }).compile();

    service = module.get<AIService>(AIService);
  });

  describe('generateContent', () => {
    it('should return mock content when no API key is set (gemini)', async () => {
      const result = await service.generateContent({
        prompt: 'Test prompt',
        provider: 'gemini',
      });

      expect(result).toBeDefined();
      expect(result.caption).toBeDefined();
      expect(result.hashtags).toBeInstanceOf(Array);
      expect(result.hook).toBeDefined();
      expect(result.providerUsed).toContain('Mock');
    });

    it('should return mock content when no API key is set (openai)', async () => {
      const result = await service.generateContent({
        prompt: 'Test prompt',
        provider: 'openai',
      });

      expect(result).toBeDefined();
      expect(result.providerUsed).toContain('Mock');
    });

    it('should return mock content when no API key is set (claude)', async () => {
      const result = await service.generateContent({
        prompt: 'Test prompt',
        provider: 'claude',
      });

      expect(result).toBeDefined();
      expect(result.providerUsed).toContain('Mock');
    });

    it('should default to gemini provider when none specified', async () => {
      const result = await service.generateContent({
        prompt: 'Test prompt',
      });

      expect(result).toBeDefined();
      expect(result.providerUsed).toContain('gemini');
    });

    it('should include prompt text in mock caption', async () => {
      const result = await service.generateContent({
        prompt: 'iPhone 18 review',
      });

      expect(result.caption).toContain('iPhone 18 review');
    });

    it('should return hashtags as array of strings', async () => {
      const result = await service.generateContent({
        prompt: 'test',
      });

      expect(result.hashtags.length).toBeGreaterThan(0);
      result.hashtags.forEach((tag) => {
        expect(typeof tag).toBe('string');
      });
    });
  });

  describe('translate', () => {
    it('should return mock translation when no API key is set', async () => {
      const result = await service.translate({
        text: 'Xin chào',
        targetLang: 'en',
      });

      expect(result).toBeDefined();
      expect(result.targetLang).toBe('en');
      expect(result.translated).toContain('Xin chào');
      expect(result.providerUsed).toContain('Mock');
    });

    it('should preserve target language in result', async () => {
      const result = await service.translate({
        text: 'Hello',
        targetLang: 'ja',
        sourceLang: 'en',
      });

      expect(result.targetLang).toBe('ja');
      expect(result.sourceLang).toBe('en');
    });
  });

  describe('analyzeSentiment', () => {
    it('should return mock sentiment when no API key is set', async () => {
      const result = await service.analyzeSentiment({
        text: 'This is great!',
      });

      expect(result).toBeDefined();
      expect(['positive', 'negative', 'neutral', 'mixed']).toContain(result.sentiment);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.summary).toBeDefined();
      expect(result.providerUsed).toContain('Mock');
    });
  });
});
