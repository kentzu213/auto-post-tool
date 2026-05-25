import { Test, TestingModule } from '@nestjs/testing';
import { FacebookPublisher } from './facebook.publisher';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('FacebookPublisher', () => {
  let publisher: FacebookPublisher;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FacebookPublisher],
    }).compile();

    publisher = module.get<FacebookPublisher>(FacebookPublisher);
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

    it('nên trả về true khi gọi API Facebook thành công', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: { id: 'page_id_123' } });
      
      const result = await publisher.validate('real_token_123');
      
      expect(result).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/me'),
        expect.any(Object)
      );
    });

    it('nên trả về false khi gọi API Facebook thất bại', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Invalid token'));
      
      const result = await publisher.validate('expired_token_123');
      
      expect(result).toBe(false);
    });
  });

  describe('publish', () => {
    const mockContent = 'Hello Facebook!';
    const mockOptions = { accessToken: 'mock_token', pageId: '123' };

    it('nên trả về lỗi nếu không có accessToken', async () => {
      const result = await publisher.publish(mockContent, []);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Thiếu Facebook Page Access Token');
    });

    it('nên đăng bài viết dạng Text thành công ở Mock Mode', async () => {
      const result = await publisher.publish(mockContent, [], mockOptions);
      
      expect(result.success).toBe(true);
      expect(result.publishedPostId).toBeDefined();
      expect(result.url).toContain('/posts/mock_id');
    });
  });
});
