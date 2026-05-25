# Changelog

All notable changes to Auto-Post Tool will be documented in this file.

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
