# Implementation Plan: SaaS Production Deployment

## Overview

This plan turns the existing TypeScript monorepo (`apps/api` NestJS + Prisma + BullMQ, `apps/web` Next.js, `apps/worker` BullMQ consumer, `apps/desktop` Electron) into a hosted multi-tenant SaaS. Implementation language is **TypeScript** for application code (matching the existing stack) with Dockerfiles, a Caddyfile, Docker Compose, GitHub Actions YAML, and shell scripts for infrastructure. Property-based tests use **fast-check** with the existing Jest setup (≥ 100 iterations, tagged `Feature: saas-production-deployment, Property k`).

Tasks build incrementally: foundation (config fail-fast, health/version) first so later infra can rely on it, then hardened images and the production topology, then media/worker correctness, observability, backups, smoke/rollback, CI/CD promotion, the thin desktop client, and finally the security middleware and launch gate.

Conventions used below:
- Sub-tasks marked `*` are optional/test/verification tasks and are **not** auto-implemented.
- Sub-tasks tagged `(MANUAL/INFRA)` cannot be validated by a pure unit test (they require a live proxy/CA, a deployed environment, or an external scan) and are documented as operator/integration steps.
- `_Requirements: N.M_` traces each task to acceptance criteria; `Property k` marks tasks that realize a Correctness Property from the design.

## Tasks

- [x] 1. Config_Loader, secrets fail-fast, and redaction
  - [x] 1.1 Create shared redaction helper
    - Add `apps/api/src/common/config/redaction.ts` exporting `redactConfig()` / `redactValue()` that returns key names only and masks values for any key matching a secret pattern (`*_SECRET`, `*_KEY`, `*_PASSWORD`, `DATABASE_URL`, OAuth secrets, decrypted token fields)
    - _Requirements: 6.3, 12.7_
  - [x] 1.2 Implement API Config_Loader with fail-fast validation
    - Add `apps/api/src/common/config/config-loader.ts` with `loadConfig(processEnv, 'api')`: compute missing/empty `Required_Config_Variable`s, log only the missing names, then `process.exit(1)`; validate `ENCRYPTION_KEY` is 64 hex chars; return a typed config object holding secrets in memory only
    - Required set for `api`: `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `ENCRYPTION_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`, OAuth client secrets, `CORS_ORIGINS`
    - _Requirements: 6.1, 6.2, 6.5, 6.6_ — Property 4
  - [ ]* 1.3 Write property test for config fail-fast
    - **Property 4: Config fail-fast on missing required variable**
    - **Validates: Requirements 6.2** — generate non-empty subsets of required vars to unset; assert non-zero exit and that every unset name (and no secret value) is recorded
    - _Requirements: 6.2_
  - [x] 1.4 Wire API Config_Loader into bootstrap
    - Call `loadConfig` at the top of `apps/api/src/main.ts` before `app.listen`; replace ad-hoc `process.env` reads with the validated config; on missing config the process must exit non-zero before listening
    - _Requirements: 6.1, 6.2_
  - [x] 1.5 Implement and wire Worker Config_Loader
    - Add a worker config loader and call it at the top of `apps/worker/src/index.ts` before connecting to Redis; required set for `worker`: `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `ENCRYPTION_KEY`, `S3_*`, OAuth client secrets
    - _Requirements: 6.1, 6.2, 6.4_
  - [ ]* 1.6 Write property test for token encryption round-trip
    - **Property 9: Token encryption round-trip**
    - **Validates: Requirements 15.5** — for arbitrary plaintext, assert `decrypt(encrypt(p)) === p` under the existing `CryptoService` AES-256-GCM and that ciphertext ≠ plaintext
    - _Requirements: 15.5_
  - [ ]* 1.7 Write unit tests for redaction helper
    - Assert secret values are masked and non-secret keys pass through
    - _Requirements: 6.3, 12.7_

- [x] 2. Health, readiness, and version endpoints
  - [x] 2.1 Upgrade health endpoints with real readiness and /version
    - In `apps/api/src/modules/health/`: add `/health/live` (process up, no dep checks), make `/health/ready` actually probe Postgres (`SELECT 1`), Redis (`PING`), and Object_Storage (`HeadBucket`) with short timeouts returning 200 ready / 503 not_ready, add `/version` returning `{ commit: APP_COMMIT_SHA, buildId: APP_BUILD_ID }`, and keep `/health` as an alias of `/health/live`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 1.7_ — Property 5, Property 2
  - [ ]* 2.2 Write property test for readiness reflecting dependency reachability
    - **Property 5: Readiness reflects dependency reachability**
    - **Validates: Requirements 8.2, 8.3** — mock the three dependency pings, generate up/down subsets, assert 200 "ready" iff all up else 503 "not_ready"
    - _Requirements: 8.2, 8.3_
  - [ ]* 2.3 Write unit tests for /version
    - Assert `/version` reflects injected `APP_COMMIT_SHA` / `APP_BUILD_ID`
    - _Requirements: 8.4_

- [x] 3. Checkpoint - foundation ready
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Hardened multi-stage Dockerfiles
  - [x] 4.1 Harden the API Dockerfile
    - Rewrite `apps/api/Dockerfile`: pinned `node:20-alpine@sha256:...` base in builder and runner, `pnpm install --frozen-lockfile`, `prisma generate`, prune dev deps for runtime, `ARG COMMIT_SHA`/`ARG BUILD_ID` → `ENV APP_COMMIT_SHA`/`APP_BUILD_ID`, `USER node`, and `HEALTHCHECK` hitting `/health/live`
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.7, 1.8_
  - [x] 4.2 Harden the Web Dockerfile
    - Rewrite `apps/web/Dockerfile`: pinned digest base, multi-stage build copying only `.next` + `public` + pruned deps, `USER node`, `HEALTHCHECK` on the web health route, `COMMIT_SHA`/`BUILD_ID` build args
    - _Requirements: 1.2, 1.3, 1.4, 1.8_
  - [x] 4.3 Harden the Worker Dockerfile
    - Rewrite `apps/worker/Dockerfile`: pinned digest base, multi-stage prune, `prisma generate`, `apk add --no-cache ffmpeg`, `/tmp` scratch owned by `node`, `USER node`, `COMMIT_SHA`/`BUILD_ID` build args
    - _Requirements: 1.2, 1.3, 1.4, 1.5_
  - [x] 4.4 Add/extend .dockerignore files
    - Ensure root and per-app `.dockerignore` exclude `.env`, `**/.env`, `node_modules`, `.git`, `dist`, `.next`, `.turbo` so no secret or dev artifact enters an image layer
    - _Requirements: 1.5_
  - [ ]* 4.5 Write property test for Dockerfile and topology hardening
    - **Property 18: Build & topology hardening invariants**
    - **Validates: Requirements 1.3, 1.4, 4.6** — parse all Dockerfiles (assert every `FROM` pinned to digest/version, never `latest`; assert a `USER` directive sets non-root) and parse `docker-compose.prod.yml` (assert no `ports:` on postgres/redis/minio). Static parse over the file set, not a deployed system
    - _Requirements: 1.3, 1.4, 4.6_

- [x] 5. Production Compose rework and Caddy reverse proxy
  - [x] 5.1 Author the Caddyfile
    - Add `Caddyfile` with app + api virtual hosts, automatic TLS (ACME email), `reverse_proxy web:3000` / `api:3001` with `header_up X-Forwarded-Proto/Host`, gzip/zstd encoding; WebSocket upgrades and HTTP→HTTPS redirect are handled by Caddy automatically
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5_ — Property 16
  - [x] 5.2 Rework docker-compose.prod.yml topology
    - Edit `docker-compose.prod.yml`: add `caddy` service (only host ports 80/443) with `caddy_data`/`caddy_config` named volumes; remove all `ports:` from `postgres`/`redis`/`minio` (internal `autopost_prod_net` only); switch redis command to `--appendonly yes --appendfsync everysec`; add a one-shot `migrate` service (`restart: "no"`, api image, runs `prisma migrate deploy`); set `worker` `restart: always`; add `healthcheck` + `depends_on: condition: service_healthy`; pin every image by digest; stop publishing web/api host ports
    - _Requirements: 3.2, 3.6, 3.7, 4.6, 5.6, 7.1, 7.3, 7.5_
  - [x] 5.3 Set trust proxy in API bootstrap
    - In `apps/api/src/main.ts` add `app.set('trust proxy', 1)` so forwarded host/proto are honored for external URL construction
    - _Requirements: 4.5_
  - [ ]* 5.4 Verify TLS issuance, hot reload, persistence, and expired-cert recovery (MANUAL/INFRA)
    - Against the Let's Encrypt **staging** CA: fresh-start issuance, hot reload, persistence across container recreation, and seed an expired cert state to assert HTTPS is restored with zero operator action. Requires a live Caddy + ACME, not a unit test
    - _Requirements: 5.1, 5.3, 5.5, 5.6_
  - [ ]* 5.5 Verify data-service ports are externally unreachable (MANUAL/INFRA)
    - Run an external port scan against the deployed host asserting 5432/6379/9000 are not reachable from the public internet
    - _Requirements: 4.6_

- [x] 6. Object storage media path
  - [x] 6.1 Create the S3 storage client/service
    - Add an S3 SDK client/service in `apps/api/src/modules/media/` configured from `S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET_NAME` (MinIO default, R2/S3 by swapping endpoint+creds) exposing `putObject`, `getObjectStream`, and `presignGet(key, ttl)`
    - _Requirements: 11.1, 11.5_
  - [x] 6.2 Replace local-disk upload with object storage put
    - In `media.service.ts`/`media.controller.ts` replace disk storage with `putObject` using tenant-scoped keys `${workspaceId}/${uuid}-${safeName}`; persist the object **key** in the DB (never a localhost URL)
    - _Requirements: 11.2, 11.3_
  - [x] 6.3 Implement signed-URL / streaming media read
    - Add a media-serve path that authorizes the requester then returns a `Signed_URL` (`presignGet` with configured TTL) by default or streams `getObjectStream` through API_Service as the stricter-control fallback
    - _Requirements: 11.3, 11.4_ — Property 11, Property 12
  - [x] 6.4 Remove local /uploads static serving
    - Remove `app.use('/uploads', express.static(...))` from `apps/api/src/main.ts` so media is never served from local disk
    - _Requirements: 11.3_
  - [ ]* 6.5 Write property test for media reference never localhost/disk
    - **Property 11: Served media never references local disk or localhost**
    - **Validates: Requirements 11.3** — generate uploads/keys; assert the returned reference is an API route or a Signed_URL host, never a localhost address or filesystem path
    - _Requirements: 11.3_
  - [ ]* 6.6 Write property test for Signed_URL expiry
    - **Property 12: Signed_URL expiry**
    - **Validates: Requirements 11.4** — generate TTLs and access times; assert read access is permitted before expiry and denied after
    - _Requirements: 11.4_

- [x] 7. Worker and Redis 24/7 reliability
  - [x] 7.1 Configure retry, backoff, and dead-letter for publish jobs
    - In `apps/worker/src/queue/` set BullMQ job options `attempts` + `backoff` (increasing delay); ensure the processor rethrows so BullMQ counts attempts; on exhausting attempts record the failure reason into the Dead_Letter_Store (failed set / durable record)
    - _Requirements: 3.3, 3.4, 3.5_ — Property 7
  - [ ]* 7.2 Write property test for retry then dead-letter
    - **Property 7: Publish-job retry then dead-letter**
    - **Validates: Requirements 3.4, 3.5** — with a mocked queue, generate failure counts; assert attempts are capped at the configured max, backoff grows, and an exhausted job lands in the Dead_Letter_Store with its reason
    - _Requirements: 3.4, 3.5_
  - [x] 7.3 Ensure token-refresh and sync jobs run server-side on schedule
    - Verify/implement the repeatable token-refresh and sync jobs are registered on the worker so platform credentials refresh without End_User interaction
    - _Requirements: 3.1, 3.8_

- [x] 8. Checkpoint - core services hardened
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Observability
  - [x] 9.1 Add structured JSON logging
    - Wire `nestjs-pino` into `apps/api/src/main.ts` for HTTP request logs and add a JSON logger in the worker for job-outcome logs; route both through the redaction helper so secrets/decrypted tokens are excluded
    - _Requirements: 12.1, 12.7_ — Property 15
  - [x] 9.2 Add Sentry error sink with global handlers
    - Initialize `@sentry/node` in api + worker; capture unhandled errors via a NestJS global exception filter (API) and the BullMQ `failed` handler (worker)
    - _Requirements: 12.2_
  - [x] 9.3 Replace ConsoleSpanExporter with OTLP and add metrics
    - In `apps/api/src/otel-sdk.ts` replace the console exporter with an OTLP exporter; expose metrics including application error rate and Publish_Job failure count
    - _Requirements: 12.3_
  - [x] 9.4 Configure alerts on dead-letter and error-rate threshold
    - Configure alert rules: raise an Alert when the error rate exceeds its threshold over the window, and when any job is moved to the Dead_Letter_Store
    - _Requirements: 12.4, 12.5_
  - [ ]* 9.5 Write property test for structured log validity
    - **Property 15: Structured log validity**
    - **Validates: Requirements 12.1** — generate HTTP/job outcomes; assert each emitted log line is valid JSON containing timestamp, level, request/job id, route/queue, and outcome
    - _Requirements: 12.1_

- [x] 10. Backups and restore
  - [x] 10.1 Implement the daily backup script
    - Add a backup script (`scripts/backup.sh` or a backup app) that runs `pg_dump | gzip`, mirrors the Object_Storage bucket, prunes backups older than `RETENTION_DAYS` (≥ 7), and records + alerts on any step failure
    - _Requirements: 13.1, 13.2, 13.3, 13.6_ — Property 13
  - [ ]* 10.2 Write property test for backup retention boundary
    - **Property 13: Backup retention boundary**
    - **Validates: Requirements 13.3** — generate backups with assorted ages; assert the prune logic keeps every backup within retention and removes every backup older than it
    - _Requirements: 13.3_
  - [x] 10.3 Add the backup service to production Compose
    - Add a scheduled backup service (cron container) to `docker-compose.prod.yml` writing to a separate `backups` named volume off the primary data volumes
    - _Requirements: 13.1, 13.2_
  - [x] 10.4 Write the Restore_Procedure runbook
    - Add `docs/RESTORE.md` documenting restore of Postgres (`gunzip | psql` into an empty DB) and Object_Storage (`mc mirror` / provider restore), ending with a `/health/ready` check
    - _Requirements: 13.4, 13.5, 13.7_
  - [ ]* 10.5 Run the restore drill (MANUAL/INFRA)
    - **Property 14: Backup → restore round-trip** (validated by harness, not a pure unit test)
    - **Validates: Requirements 13.4, 13.5** — execute the documented Restore_Procedure against an empty Postgres and a clean bucket using a real backup, then assert `/health/ready` is 200 and spot-check restored rows/objects
    - _Requirements: 13.4, 13.5_

- [x] 11. Smoke test and rollback
  - [x] 11.1 Implement the smoke test script
    - Add `scripts/smoke.ts` (or `.sh`) that asserts `/health/live` 200, `/health/ready` 200, `GET /version.commit === EXPECTED_SHA`, an authenticated login, and creation of a scheduled post against a target base URL
    - _Requirements: 10.1_ — Property 2
  - [ ]* 11.2 Write tests for smoke-script assertions
    - Unit/integration test the smoke assertions against a stubbed API (status codes, `/version.commit` equality, scheduled-post creation)
    - _Requirements: 10.1_
  - [x] 11.3 Implement the rollback script
    - Add `scripts/rollback.sh` that looks up the last successful SHA from the Deploy_Audit_Record, redeploys api/web/worker at that SHA, and waits until `/version.commit === prevSHA` and `/health/ready` is 200 (backward-compatible schema makes this safe)
    - _Requirements: 10.2, 10.3, 10.4_
  - [x] 11.4 Write the rollback procedure runbook
    - Add `docs/ROLLBACK.md` documenting the manual rollback an Operator can execute to return Production to a prior Container_Image
    - _Requirements: 10.5_

- [x] 12. CI/CD pipeline (build, scan, publish, promote)
  - [x] 12.1 Extend ci.yml with image build, Trivy scan, and GHCR publish
    - In `.github/workflows/ci.yml`, after the existing build+test pass: build api/web/worker images with `--build-arg COMMIT_SHA=$GITHUB_SHA --build-arg BUILD_ID=$GITHUB_RUN_ID`, run Trivy on each image failing on HIGH/CRITICAL, then push to GHCR tagged `:sha-<commit>` and `:<semver>`; on build/test/scan failure stop without publishing
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 2.1, 2.4, 1.6, 1.7_
  - [x] 12.2 Add the staging deploy job
    - Add `.github/workflows/deploy.yml` staging job: SSH to the staging host, `docker compose pull` by `:sha`, run the `migrate` one-shot, recreate services, then run the smoke script against staging; stop the run if staging smoke fails (before prod)
    - _Requirements: 9.6, 2.4, 7.1_
  - [x] 12.3 Add the prod deploy job with audit record and launch gate
    - In `deploy.yml` add the production job gated on a GitHub `production` environment approval (the Tenant_Isolation_Gate / workspace-authorization launch precondition): deploy the **same** `:sha` artifact, run the prod smoke test, invoke the rollback script on smoke failure, and write the `Deploy_Audit_Record` (commit/semver/env/timestamp/image refs) to a queryable destination
    - _Requirements: 2.2, 2.3, 10.1, 10.2, 10.3, 9.5, 12.6, 15.1_

- [x] 13. Desktop thin-client
  - [x] 13.1 Convert the Electron app to a thin hosted-URL shell
    - In `apps/desktop` remove port-probing (5432/6379/9000/3001/3005), `startNodeService`/spawn logic, and `resolveWorkspaceRoot`; implement `resolveBaseUrl()` precedence (`IZZI_SERVER_URL` env → persisted config file → first-run prompt → default hosted URL) and `mainWindow.loadURL(base)`
    - _Requirements: 14.3, 14.4_
  - [ ]* 13.2 Write unit tests for resolveBaseUrl precedence
    - Assert env wins over config file wins over prompt wins over default
    - _Requirements: 14.4_

- [x] 14. Security middleware and launch gate
  - [x] 14.1 Lock down admin UI, Swagger, and production CORS/URLs
    - In `apps/api/src/main.ts` place Bull Board (`/admin/queues`) behind an auth guard / basic-auth middleware, confirm Swagger is mounted only when `NODE_ENV !== 'production'`, and set the CORS allowlist + external URLs from production config (no localhost)
    - _Requirements: 6.6, 15.2, 15.3, 15.4_
  - [ ]* 14.2 Write integration test for production security enforcement
    - **Property 17: Production security enforcement** (harness/integration, not fast-check)
    - **Validates: Requirements 15.2, 15.4** — assert Helmet headers present, off-allowlist origin rejected, burst beyond rate limit throttled, and `/admin/queues` without auth denied
    - _Requirements: 15.2, 15.4_
  - [x] 14.3 Write the incident response playbook
    - Add `docs/INCIDENT-PLAYBOOK.md` covering Rollback of a bad deploy and the Restore_Procedure for Postgres and Object_Storage (references docs/ROLLBACK.md and docs/RESTORE.md)
    - _Requirements: 15.6_
  - [x] 14.4 Document the tenant-isolation launch gate dependency
    - Document in the spec/ops notes that public production launch is blocked until the `workspace-authorization` spec is implemented and verified; this is a hard precondition wired as the `production` environment approval in task 12.3 and is **not** implemented in this spec
    - _Requirements: 15.1_

- [x] 15. Final checkpoint - full pipeline verified
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and are not auto-implemented; they cover property-based tests, unit tests, and manual/infra verification.
- `(MANUAL/INFRA)` sub-tasks (5.4 TLS against LE staging, 5.5 external port scan, 10.5 restore drill) require a live proxy/CA, a deployed environment, or an external scan — they are validated by an integration harness or operator step, not a pure unit test.
- Property-based tests use fast-check with ≥ 100 iterations, each tagged `Feature: saas-production-deployment, Property k`. The cheap pure-logic invariants are implemented as PBTs: Property 4 (1.3), 9 (1.6), 5 (2.2), 18 (4.5), 11 (6.5), 12 (6.6), 7 (7.2), 15 (9.5), 13 (10.2). Properties 1/2/3/8/10/14/17 are realized as harness/integration assertions per the design's Testing Strategy.
- Each task references the specific requirements it satisfies; checkpoints (tasks 3, 8, 15) provide incremental validation breaks.
- The `workspace-authorization` fix is a hard launch precondition (Req 15.1), enforced as the production environment approval gate in task 12.3 and documented in 14.4 — it is a dependency, not implemented here.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "4.1", "4.2", "4.3", "4.4", "5.1", "6.1"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5", "1.6", "1.7", "2.1", "5.2", "6.2", "7.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.5", "5.3", "6.3", "7.2", "7.3", "10.1", "11.1", "12.1"] },
    { "id": 3, "tasks": ["5.4", "5.5", "6.4", "6.5", "6.6", "10.2", "10.3", "10.4", "11.2", "11.3", "13.1"] },
    { "id": 4, "tasks": ["9.1", "10.5", "11.4", "12.2", "13.2"] },
    { "id": 5, "tasks": ["9.2", "9.3", "12.3", "14.3"] },
    { "id": 6, "tasks": ["9.4", "9.5", "14.1", "14.4"] },
    { "id": 7, "tasks": ["14.2"] }
  ]
}
```
