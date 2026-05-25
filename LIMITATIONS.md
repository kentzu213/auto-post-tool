# Limitations & Known Issues

## Current Limitations (v1.0.0)

### Authentication
- [ ] 2FA (Two-Factor Authentication) not implemented yet
- [ ] Password reset flow not implemented
- [ ] Session management limited to JWT (no refresh token rotation)

### Social Platform APIs
- [ ] Facebook: Page tokens auto-refresh not implemented (manual re-auth needed every 60 days)
- [ ] TikTok: Content Posting API uses "Inbox Draft" mode only (direct publish requires approved app)
- [ ] YouTube: No playlist management support
- [ ] Instagram: Not yet supported (planned via Facebook Graph API IG endpoints)

### Worker System
- [ ] Single worker process (not split per-platform yet — E1-E4 planned)
- [ ] No dead letter queue (DLQ) for permanently failed jobs
- [ ] Media queue worker not implemented (enqueue works, but no consumer)
- [ ] Webhooks module not implemented (B9 planned)

### Media Pipeline
- [ ] FFmpeg must be installed on host machine (no Docker-internal FFmpeg yet)
- [ ] Whisper API requires OpenAI API key (no local faster-whisper fallback)
- [ ] Auto-reframe uses center-crop only (no face detection / smart crop)
- [ ] Long-to-short uses fixed interval splitting (no scene detection)
- [ ] Maximum file size limited by server memory (no streaming uploads)

### AI Features
- [ ] AI content generation uses basic prompting (no fine-tuned models)
- [ ] No content history/versioning for AI-generated outputs
- [ ] Sentiment analysis has no batch processing mode
- [ ] Translation quality depends entirely on the chosen provider

### Frontend
- [ ] No dark/light mode toggle (dark mode only)
- [ ] No responsive mobile layout (desktop-optimized)
- [ ] Calendar lacks drag-and-drop rescheduling
- [ ] No real-time WebSocket updates (polling-based)
- [ ] Login/Register pages are stub only

### Testing
- [ ] Unit test coverage < 80% target
- [ ] No E2E tests (Playwright planned)
- [ ] No load/stress testing

### Infrastructure
- [ ] No Kubernetes manifests
- [ ] No blue-green or canary deployment support
- [ ] OTel exports to console only (no Grafana/Jaeger exporter configured)
- [ ] No CDN integration for media delivery

## Planned Improvements
See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full technical roadmap.
