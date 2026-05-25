# Hướng Dẫn Triển Khai (Deployment Guide) lên VPS Ubuntu 22.04

Tài liệu này hướng dẫn bạn cách deploy hệ thống Auto-Post Tool lên VPS Ubuntu 22.04 để chạy môi trường Production thực tế.

---

## 🛠️ Bước 1: Chuẩn bị máy chủ & Cài đặt Docker
Đăng nhập vào VPS của bạn qua SSH và chạy các lệnh sau:

```bash
# Cập nhật hệ thống
sudo apt update && sudo apt upgrade -y

# Cài đặt Docker
sudo apt install apt-transport-https ca-certificates curl software-properties-common -y
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io -y

# Cài đặt Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.5/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Kiểm tra cài đặt thành công
docker --version
docker-compose --version
```

---

## 🏗️ Bước 2: Clone dự án và cấu hình biến môi trường Production
Tải code của bạn lên VPS (hoặc git clone), sau đó tạo file `.env` ở root monorepo:

```bash
cd /var/www/auto-post-tool
cp .env.example .env
nano .env
```

**Cập nhật các tham số Production quan trọng:**
- `DATABASE_URL`: Trỏ tới container PostgreSQL hoặc DB Cloud của bạn.
- `JWT_SECRET`: Đổi thành một chuỗi bảo mật ngẫu nhiên dài.
- `ENCRYPTION_KEY`: Đổi thành một chuỗi 64 ký tự hex ngẫu nhiên.
- Điền các OAuth API Keys và Client Secret thật của Meta Business, Google Console, TikTok Developers.

---

## 🚀 Bước 3: Khởi chạy hệ thống bằng Docker Compose Production
Chạy lệnh sau ở root monorepo để Docker tự động build mã nguồn (NestJS, NextJS, Worker) và khởi động toàn bộ hạ tầng:

```bash
docker-compose -f docker-compose.prod.yml up -d --build
```

### Chạy Database Migration để tạo bảng trong PostgreSQL:
```bash
docker exec -it autopost_prod_api npx prisma migrate deploy
```

---

## 🔒 Bước 4: Cấu hình Nginx & Let's Encrypt SSL
Để người dùng truy cập an toàn qua HTTPS, cài đặt Nginx và Certbot:

```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

### Cấu hình file `/etc/nginx/sites-available/autopost`:
```nginx
server {
    listen 80;
    server_name yourdomain.com api.yourdomain.com;

    location / {
        # Web NextJS chạy ở cổng 3000
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Kích hoạt config và restart Nginx
sudo ln -s /etc/nginx/sites-available/autopost /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Tải SSL Let's Encrypt tự động
sudo certbot --nginx -d yourdomain.com -d api.yourdomain.com
```

Certbot sẽ tự cấu hình SSL, tự động redirect HTTP sang HTTPS và tự renew hàng tháng. Hệ thống của bạn đã production-ready 100%!
