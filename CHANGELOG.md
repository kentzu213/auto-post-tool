# Changelog

All notable changes to Auto-Post Tool will be documented in this file.

## [1.1.1] - 2026-05-31

### Sửa lỗi Launcher (Desktop) — API & Web báo "LỖI" sau khi cài .exe
- **Nguyên nhân gốc**: Trình khởi chạy Electron là *thin launcher*. Khi chạy bản đã đóng gói (`app.isPackaged = true`), `__dirname` nằm trong `resources/app.asar`, nên `resolveWorkspaceRoot()` (chỉ dựa vào `__dirname/../..` và `IZZI_APP_ROOT`) không tìm được `apps/api/dist/src/main.js` → API và Web bị gán trạng thái `'error'` ("LỖI"), trong khi DB hiển thị xanh do kiểm tra trực tiếp cổng Docker thật.
- **Khắc phục (Option A — thin launcher tin cậy hơn)**:
  - Nhúng đường dẫn tuyệt đối của monorepo vào bản build qua `app-config.json` (sinh bởi `generate-config.js` ngay trước khi `electron-builder` đóng gói). Bản `.exe` đã cài đọc file này để tìm lại mã nguồn đã build.
  - `resolveWorkspaceRoot()` nay thử lần lượt: `IZZI_APP_ROOT` → `appRoot` nhúng từ build → `__dirname/../..`.
  - Thêm `checkProductionBuild()` kiểm tra đúng artifact production cho từng dịch vụ: API (`apps/api/dist/src/main.js`), Web (`apps/web/.next/BUILD_ID` — yêu cầu `next build`, không phải `next dev`), Worker (`apps/worker/dist/index.js`).
  - Thông điệp lỗi trên Launcher nay nêu rõ thiếu gì và cách xử lý (đặt `IZZI_APP_ROOT` hoặc chạy `next build`), thay cho nhãn "LỖI" trống.
- **Lưu ý mô hình thin-launcher**: Bản `.exe` vẫn cần monorepo có sẵn trên ổ đĩa + hạ tầng Docker (PostgreSQL/Redis/MinIO) đang chạy + các file `.env`. Nếu repo nằm ở đường dẫn khác mặc định, đặt biến môi trường `IZZI_APP_ROOT` trỏ tới thư mục dự án.

## [1.1.0] - 2026-05-31

### Analytics trung thực & gần real-time
- **BREAKING (hành vi)**: Gỡ bỏ toàn bộ số liệu analytics giả sinh bằng `Math.random()` ở worker (sau khi publish) và ở `AnalyticsService.getDashboardSummary()` (đường đọc không còn ghi dữ liệu bịa)
- Worker khi publish thành công chỉ tạo bản ghi Analytics khởi tạo bằng 0 (chờ đồng bộ), không bịa số
- Pipeline đồng bộ insights thật: cron `syncRealAnalytics` (mỗi 15 phút) gọi `getInsights()` của từng provider và upsert số liệu thật vào bảng Analytics theo `scheduleId`
- Nối dây `getInsights()` (trước đây là code chết): Facebook truyền access token đúng; YouTube gọi `videos.list?part=statistics` (views/likes/comments); TikTok gated chờ App Audit
- Bỏ qua tài khoản/token mock; lỗi/rate-limit → giữ số liệu cũ, không xóa, không bịa
- Dashboard API trả thêm `lastSyncedAt` và `dataSource` (`live` / `demo` / `pending`)
- Dashboard FE: auto-refresh 30s (silent), hiển thị "Cập nhật lúc...", badge nguồn dữ liệu trung thực thay cho nhãn "Thực Tế"

### Hộp thư đa kênh thật (Unified Inbox)
- Thay dữ liệu inbox mock hardcode bằng pipeline ingestion thật
- `InboxIngestionService` poll định kỳ (mỗi 3 phút) + endpoint `POST /inbox/sync` để đồng bộ thủ công
- Facebook Messenger: kéo hội thoại Page (`/{page-id}/conversations` + messages), chỉ giữ tin của khách
- YouTube: kéo comment threads của kênh (`commentThreads.list`)
- TikTok: gated honest (chờ App Audit), không bịa dữ liệu
- Dedupe theo khóa ổn định `{socialAccountId}:{platform}:{externalId}`; sanitize text chống injection; giữ trạng thái đã đọc qua mỗi lần re-sync
- Inbox FE: nối API thật (messages/unread/mark-read/mark-all-read), auto-refresh 30s, nút "Đồng bộ ngay", empty-state trung thực

### Facebook publisher
- `getInsights()` truyền `access_token` đúng vào params (trước đây thiếu khiến call thật luôn lỗi)

## [1.0.0] - 2026-05-25

### Phase 1: Security & Bug Fixes
- **BREAKING**: Facebook Graph API upgraded from v19.0 → v22.0
- **BREAKING**: YouTube upload switched from multipart to Resumable Upload Protocol
- Removed hardcoded ENCRYPTION_KEY fallback (now requires env var)
- Added Helmet HTTP security headers
- Added ThrottlerModule rate limiting (100 req/60s global)
- CORS whitelist replaces wildcard `*`
- Added `/health` and `/health/ready` endpoints
- Facebook Reels 3-phase upload support
- Facebook Story publishing support
- YouTube thumbnail upload support
- Facebook error categorization (TOKEN_EXPIRED, RATE_LIMIT, PERMISSION_DENIED)
- Swagger protected in production mode

### Phase 2: API Modules
- PostsModule: CRUD + scheduling + stats
- CampaignsModule: CRUD + KPI tracking
- AnalyticsModule: Dashboard + Heatmap + Platform breakdown
- InboxModule: Unified inbox + mark-read + unread count
- Worker YouTube upload aligned with Resumable protocol

### Phase 3: Database & New Modules
- Prisma schema: 8 new models (PostVersion, Template, HashtagSet, RSSSource, ApprovalRequest, Notification, QuotaAssignment, TeamMember)
- 7 new enums (ApprovalStatus, NotificationType, Role, AccountStatus, ContentType, etc.)
- TemplatesModule: Content template CRUD
- NotificationsModule: Paginated list, mark-as-read, unread count
- ApprovalsModule: Transactional post approval workflow

### Phase 4: Frontend Refactor
- Monolith page.tsx (1,297 lines) → modular App Router architecture
- CSS Design System: 80+ custom properties, glassmorphism, responsive
- API Client with JWT interceptor and 401 redirect
- Zustand global store for auth, accounts, UI state
- 7 pages: Dashboard, Composer, Calendar, Inbox, Accounts, Settings, root redirect
- Sidebar navigation with active state highlighting
- NotificationToast component

### Phase 5: AI & Media Pipeline
- 3-provider AI engine: Google Gemini, OpenAI GPT-4o, Anthropic Claude
- Platform-specific content optimization (Facebook/YouTube/TikTok prompts)
- i18n translation endpoint (POST /ai/translate)
- Sentiment analysis endpoint (POST /ai/sentiment)
- Platform-specific FFmpeg presets (codec, bitrate, resolution per platform)
- Whisper API subtitle generation with audio extraction
- Auto-reframe 9:16 for Reels/Shorts/TikTok
- Long-to-short video splitting pipeline
- Media REST controller with 5 endpoints

### Phase 6: DevOps & Documentation
- CHANGELOG.md
- LIMITATIONS.md
- GitHub Actions CI/CD pipeline
- .env.example updated with all env vars

## Known Limitations
See [LIMITATIONS.md](./LIMITATIONS.md) for current limitations and planned improvements.
