import { Test, TestingModule } from '@nestjs/testing';
import { YouTubePublisher } from './youtube.publisher';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('YouTubePublisher', () => {
  let publisher: YouTubePublisher;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [YouTubePublisher],
    }).compile();

    publisher = module.get<YouTubePublisher>(YouTubePublisher);
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

    it('nên trả về true khi gọi API Google tokeninfo thành công', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { exp: '12345678' } });
      
      const result = await publisher.validate('real_token_123');
      
      expect(result).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/tokeninfo'),
        expect.any(Object)
      );
    });
  });

  describe('publish', () => {
    const mockContent = 'Video Description';
    const mockOptions = { accessToken: 'mock_token', title: 'Test Title' };

    it('nên trả về lỗi nếu không có accessToken', async () => {
      const result = await publisher.publish(mockContent, ['http://example.com/video.mp4']);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Thiếu Google OAuth Access Token');
    });

    it('nên trả về lỗi nếu không có mediaUrls', async () => {
      const result = await publisher.publish(mockContent, [], mockOptions);
      expect(result.success).toBe(false);
      expect(result.error).toContain('YouTube yêu cầu ít nhất 1 file Video');
    });

    it('nên tải video lên thành công ở Mock Mode', async () => {
      const result = await publisher.publish(mockContent, ['http://example.com/video.mp4'], mockOptions);
      
      expect(result.success).toBe(true);
      expect(result.publishedPostId).toBeDefined();
      expect(result.url).toContain('youtube.com/watch?v=');
    });
  });
});
