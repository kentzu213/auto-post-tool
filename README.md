<div align="center">

# 🚀 Auto-Post Tool

### The Ultimate AI-Powered Multi-Platform Social Media Automation Engine

**Schedule, generate, and auto-publish content across Facebook, YouTube & TikTok — from one dashboard.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=next.js&logoColor=white)](https://nextjs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![BullMQ](https://img.shields.io/badge/BullMQ-5-FF6B35?logo=redis&logoColor=white)](https://docs.bullmq.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=github-actions&logoColor=white)](/.github/workflows/ci.yml)

[**Demo**](#-quick-start) · [**Features**](#-features) · [**Architecture**](#-architecture) · [**API Docs**](#-api-documentation) · [**Contributing**](#-contributing)

</div>

---

## 🎯 Why Auto-Post Tool?

Building a social media presence across multiple platforms is **exhausting**. You need to:
- ✍️ Write platform-optimized captions for each channel
- 📅 Schedule posts at optimal times across timezones
- 🎬 Re-encode videos for each platform's specs
- 💬 Monitor and reply to comments from 3+ dashboards
- 📊 Track analytics scattered across different apps

**Auto-Post Tool solves all of this in one place** — with AI-powered content generation, intelligent scheduling, and automated multi-platform publishing.

---

## ✨ Features

### 🤖 AI Content Engine (3 Providers)
| Provider | Models | Features |
|----------|--------|----------|
| **Google Gemini** | gemini-2.0-flash | Caption, hashtags, hook generation |
| **OpenAI** | GPT-4o + Whisper | Content + subtitle transcription |
| **Anthropic Claude** | Claude Sonnet 4 | Premium content generation |

- 🌐 **i18n Translation** — Translate posts to any language instantly
- 💭 **Sentiment Analysis** — Analyze audience tone before publishing
- 🎯 **Platform-Specific Prompts** — Optimized for Facebook, YouTube, TikTok

### 📱 Multi-Platform Publishing
| Platform | Content Types | Features |
|----------|---------------|----------|
| **Facebook** | Feed, Reels, Story | Graph API v22.0, 3-phase Reels upload |
| **YouTube** | Videos, Shorts | Resumable Upload, thumbnail support |
| **TikTok** | Videos | Content Posting API, Inbox Draft mode |

### 🎬 Media Pipeline (FFmpeg)
- **Platform-Specific Presets** — Auto-transcode to each platform's optimal codec/bitrate/resolution
- **Auto-Reframe 9:16** — Horizontal → vertical crop for Reels/Shorts/TikTok
- **Long-to-Short** — Split long videos into viral short clips
- **Whisper Subtitles** — Auto-generate SRT subtitles from audio

### 📊 Analytics & Insights
- Real-time dashboard with stats grid
- Platform breakdown charts
- Publishing heatmap (best times to post)
- Campaign KPI tracking

### 🛡️ Enterprise Security
- 🔐 JWT + refresh token authentication
- 🔒 AES-256-GCM token encryption
- 🛡️ Helmet HTTP security headers
- ⚡ Rate limiting (100 req/60s)
- 🚫 CORS whitelist (no wildcards)
- ✅ Input validation (class-validator)
- 📄 Swagger protected in production

---

## 🏗️ Architecture

```
auto-post-tool/
├── apps/
│   ├── api/          # NestJS backend (REST API + Swagger)
│   ├── web/          # Next.js 14 frontend (App Router)
│   └── worker/       # BullMQ background job processor
├── packages/
│   ├── shared-types/ # Shared TypeScript interfaces
│   └── ui/           # Shared UI components
├── docker/           # Docker configs
└── .github/          # CI/CD workflows
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | NestJS 10 + TypeScript 5 |
| **Frontend** | Next.js 14 + React 18 + Zustand |
| **Database** | PostgreSQL 16 + Prisma ORM |
| **Queue** | Redis 7 + BullMQ |
| **AI** | Gemini + OpenAI + Claude |
| **Media** | FFmpeg + Whisper API |
| **Monitoring** | OpenTelemetry + Bull Board |
| **CI/CD** | GitHub Actions |
| **Package Manager** | pnpm + Turborepo |

---

## 🚀 Quick Start

### Prerequisites
- Node.js ≥ 18
- pnpm ≥ 9
- Docker & Docker Compose
- FFmpeg (optional, for media pipeline)

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/auto-post-tool.git
cd auto-post-tool
pnpm install
```

### 2. Start Infrastructure

```bash
docker compose up -d  # PostgreSQL + Redis + MinIO
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys and credentials
```

### 4. Setup Database

```bash
cd apps/api
npx prisma db push
npx prisma generate
```

### 5. Launch 🚀

```bash
# Terminal 1 — API Server
cd apps/api && pnpm run dev

# Terminal 2 — Web Frontend
cd apps/web && pnpm run dev
```

| Service | URL |
|---------|-----|
| 🌐 Frontend | http://localhost:3005 |
| 🔌 API | http://localhost:3001 |
| 📄 Swagger | http://localhost:3001/docs |
| 📊 Bull Board | http://localhost:3001/admin/queues |
| ❤️ Health Check | http://localhost:3001/health |

---

## 📚 API Documentation

Full interactive API docs available at `/docs` when running in development mode.

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/ai/generate` | Generate caption, hashtags, hook |
| `POST` | `/ai/translate` | Translate content (i18n) |
| `POST` | `/ai/sentiment` | Analyze text sentiment |
| `POST` | `/media/transcode` | Platform-specific video transcode |
| `POST` | `/media/reframe` | Auto-reframe 16:9 → 9:16 |
| `POST` | `/media/long-to-short` | Split video into short clips |
| `POST` | `/media/subtitles` | Generate subtitles (Whisper) |
| `GET` | `/posts` | List all posts |
| `POST` | `/posts` | Create & schedule post |
| `GET` | `/analytics/dashboard` | Dashboard stats |
| `GET` | `/campaigns` | List campaigns |
| `GET` | `/health` | Server health check |

---

## 🧪 Testing

```bash
# Run all tests
cd apps/api && pnpm test

# Run with coverage
cd apps/api && pnpm test -- --coverage

# Run specific test
npx jest --testPathPattern="ai.service"
```

**Current: 31 tests across 5 suites — all passing ✅**

---

## 🐳 Docker Deployment

### Development

```bash
docker compose up -d
```

### Production

```bash
docker compose -f docker-compose.prod.yml up -d
```

---

## 📂 Environment Variables

See [`.env.example`](.env.example) for all required variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_HOST` | ✅ | Redis host for BullMQ |
| `JWT_SECRET` | ✅ | JWT signing secret |
| `ENCRYPTION_KEY` | ✅ | AES-256 key for token storage |
| `GEMINI_API_KEY` | ⬜ | Google Gemini API key |
| `OPENAI_API_KEY` | ⬜ | OpenAI API key (GPT + Whisper) |
| `ANTHROPIC_API_KEY` | ⬜ | Anthropic Claude API key |
| `FACEBOOK_CLIENT_ID` | ⬜ | Meta App ID |
| `GOOGLE_CLIENT_ID` | ⬜ | Google OAuth client ID |
| `TIKTOK_CLIENT_KEY` | ⬜ | TikTok App key |

---

## 🗺️ Roadmap

- [x] Multi-platform publishing (Facebook, YouTube, TikTok)
- [x] AI content generation (Gemini, OpenAI, Claude)
- [x] Platform-specific FFmpeg presets
- [x] Long-to-short video pipeline
- [x] Whisper subtitle generation
- [x] i18n translation
- [x] Sentiment analysis
- [ ] Instagram support
- [ ] Smart auto-reframe (face detection)
- [ ] A/B testing for posts
- [ ] Team collaboration & approval workflow UI
- [ ] Mobile app (React Native)
- [ ] Webhook integrations
- [ ] RSS-to-post automation

---

## 🤝 Contributing

Contributions are welcome! Please read the [ARCHITECTURE.md](ARCHITECTURE.md) before submitting PRs.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with ❤️ by [NgNghia213](https://github.com/NgNghia213)**

⭐ **Star this repo if you find it useful!** ⭐

[Report Bug](../../issues/new?template=bug_report.md) · [Request Feature](../../issues/new?template=feature_request.md)

</div>
