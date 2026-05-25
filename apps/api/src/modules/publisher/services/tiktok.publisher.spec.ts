import { Test, TestingModule } from '@nestjs/testing';
import { TikTokPublisher } from './tiktok.publisher';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TikTokPublisher', () => {
  let publisher: TikTokPublisher;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TikTokPublisher],
    }).compile();

    publisher = module.get<TikTokPublisher>(TikTokPublisher);
    jest.clearAllMocks();
  });

  it('nên được định nghĩa', () => {
    expect(publisher).toBeDefined();
  });

  describe('validate', () => {
    it('nên trả về true với mock token', async () => {
      const result = await publisher.validate('mock_token_123');
      expect(result).toBe(true);
    });

    it('nên trả về true khi gọi API TikTok user info thành công', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { data: { open_id: 'user_123' } } });
      
      const result = await publisher.validate('real_token_123');
      
      expect(result).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/user/info/'),
        expect.any(Object)
      );
    });
  });

  describe('publish', () => {
    const mockContent = 'TikTok Caption #trending';
    const mockOptions = { accessToken: 'mock_token' };

    it('nên trả về lỗi nếu không có accessToken', async () => {
      const result = await publisher.publish(mockContent, ['http://example.com/video.mp4']);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Thiếu TikTok Access Token');
    });

    it('nên đăng video lên TikTok thành công ở Mock Mode', async () => {
      const result = await publisher.publish(mockContent, ['http://example.com/video.mp4'], mockOptions);
      
      expect(result.success).toBe(true);
      expect(result.publishedPostId).toBeDefined();
      expect(result.url).toContain('tiktok.com/@mock_user');
    });
  });
});
