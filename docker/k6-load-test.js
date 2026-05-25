import http from 'k6/http';
import { check, sleep } from 'k6';

// Cấu hình k6: Giả lập 1000 ảo người dùng (VUs) tăng dần trong 30 giây, giữ tải 1 phút và giảm dần.
export const options = {
  stages: [
    { duration: '30s', target: 500 },  // Ramp-up lên 500 VUs
    { duration: '30s', target: 1000 }, // Ramp-up tiếp lên 1000 VUs
    { duration: '1m', target: 1000 },  // Giữ tải tại 1000 VUs trong 1 phút
    { duration: '20s', target: 0 },    // Ramp-down về 0 VUs
  ],
  thresholds: {
    http_req_duration: ['p(95)<1500'], // 95% request phải có response time dưới 1.5s
    http_req_failed: ['rate<0.01'],    // Tỉ lệ lỗi phải dưới 1%
  },
};

const BASE_URL = 'http://localhost:3001';

export default function () {
  // Mock dữ liệu đăng bài
  const payload = JSON.stringify({
    title: 'Test Performance Post by k6',
    content: 'Nội dung đăng tải tự động kiểm tra hiệu năng hệ thống chịu tải của BullMQ và Redis!',
    mediaUrls: ['https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800'],
    platforms: ['facebook', 'youtube'],
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      // Dùng Mock Authorization Header bypass Auth
      'Authorization': 'Bearer mock_jwt_token_k6_test',
    },
  };

  // Gọi API Health Check
  const resHealth = http.get(`${BASE_URL}/`, params);
  check(resHealth, {
    'health check status is 200': (r) => r.status === 200,
  });

  sleep(1);
}
