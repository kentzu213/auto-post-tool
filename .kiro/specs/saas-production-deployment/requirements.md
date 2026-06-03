# Requirements Document

## Introduction

This feature turns the existing "Izzi Auto Post" / Auto-Post Tool (a pnpm + Turborepo monorepo: `apps/api` NestJS 10 + Prisma/PostgreSQL + BullMQ, `apps/web` Next.js 14 App Router, `apps/worker` BullMQ consumer, `apps/desktop` Electron launcher) into a commercially deployable, multi-tenant **SaaS**. The product goal is "cài phát chạy ngay" (install and run immediately): a customer signs up and uses the product entirely through a browser, or through a thin desktop client that points at a configurable hosted server URL, with zero local installation, no Docker, and no monorepo on the customer's machine.

The core reason this product must be a hosted SaaS rather than a local application is timing: posts are scheduled for future times. If the backend ran on the customer's PC, scheduled posts would be missed whenever that PC is powered off, asleep, or offline. Therefore the backend (`API_Service`), the background `Worker_Service`, and `Redis_Service` MUST run on a server 24/7 so that scheduled publishing and synchronization jobs execute regardless of any customer device state.

The scope of this spec is deployment and productionization, not new product features. It covers: a hosted multi-tenant backend reachable over HTTPS on a real domain with automatic TLS provisioning **and renewal including recovery from an already-expired certificate**; reproducible, hardened, containerized builds that promote the **same artifact** across environments; a 24/7 worker and Redis; health, readiness, and version endpoints used for liveness, readiness, and post-deploy smoke checks with a safe rollback path; safe forward-only / backward-compatible database migrations on deploy; runtime delivery of secrets and configuration through the server environment or a secret manager; zero-local-setup onboarding through the hosted web app and a configurable thin desktop client; hosted object storage for media served via the backend or signed URLs; observability (structured logs, error monitoring, basic metrics) with each deploy audited against a commit; and database and object-storage backups with a documented restore path.

Because the product is being opened to the public as a shared multi-tenant SaaS, tenant isolation must hold before real customers share the instance. The separate `workspace-authorization` spec (`.kiro/specs/workspace-authorization`) fixes the known Broken Access Control / IDOR defects (controllers lacking `JwtAuthGuard` and trusting a client-supplied `workspaceId`). This deployment spec does **not** implement that fix; it declares completion and verification of `workspace-authorization` as a hard precondition for public production launch.

The default target architecture is a single-VPS containerized production deployment (consistent with the existing `docker-compose.prod.yml` and `DEPLOYMENT.md`), fronted by a reverse proxy with managed TLS (Caddy or Nginx + Let's Encrypt/Certbot), with automated backups and GitHub Actions for CI/CD. Where the request describes behavior in implementation-neutral terms, this document follows that default unless the existing codebase clearly indicates otherwise.

### Non-Goals (Out of Scope)

- Building a billing or payments system (tracked separately as future work).
- Implementing the authentication/tenant-isolation fix itself — this is covered entirely by the `workspace-authorization` spec; this spec only declares the dependency.
- Full TikTok posting support (still gated by external TikTok app audit/approval).
- A fully offline, self-contained desktop application — explicitly rejected in favor of the SaaS model; the desktop client is only a thin shell pointing at the hosted server.
- Kubernetes or multi-region orchestration (single-server first; a scale path is documented only).

## Glossary

- **Deployment_System**: The complete set of production infrastructure, configuration, and automated processes defined by this spec that runs the Auto-Post Tool as a hosted SaaS.
- **API_Service**: The containerized NestJS application built from `apps/api`, serving HTTP endpoints in production.
- **Web_Service**: The containerized Next.js application built from `apps/web`, serving the browser UI in production.
- **Worker_Service**: The containerized BullMQ consumer built from `apps/worker` that executes scheduled publishing jobs, analytics/inbox synchronization jobs, and token-refresh jobs.
- **Application_Service**: Any one of API_Service, Web_Service, or Worker_Service.
- **Desktop_Client**: The `apps/desktop` Electron application, repurposed as a thin shell that loads a configurable hosted server URL.
- **Container_Image**: A built Docker image for an Application_Service.
- **Build_Pipeline**: The image build process that produces Container_Images from the monorepo source.
- **CI_CD_Pipeline**: The GitHub Actions automation that builds, tests, scans, publishes, and deploys the Deployment_System.
- **Image_Registry**: The container registry that stores published Container_Images, tagged by commit SHA and semantic version.
- **Reverse_Proxy**: The production HTTP front (Caddy, or Nginx with Certbot) that terminates TLS and routes external traffic to Web_Service and API_Service.
- **TLS_Certificate**: The X.509 certificate the Reverse_Proxy presents for the configured domain to serve HTTPS.
- **TLS_Manager**: The component of the Deployment_System that obtains, renews, and recovers the TLS_Certificate from the ACME certificate authority (for example Let's Encrypt).
- **Postgres_Service**: The production PostgreSQL 16 database instance with a persistent data volume.
- **Redis_Service**: The production Redis 7 instance, used as the BullMQ queue store, configured for on-disk persistence.
- **Object_Storage**: The production media store (self-hosted MinIO, AWS S3, or Cloudflare R2) holding uploaded media durably.
- **Data_Service**: Any one of Postgres_Service, Redis_Service, or Object_Storage.
- **Signed_URL**: A time-limited, access-controlled URL that grants temporary read access to a single object in Object_Storage.
- **Backup_Job**: An automated process that produces and stores backups of Postgres_Service and of Object_Storage.
- **Restore_Procedure**: The documented operator process for restoring Postgres_Service and Object_Storage from backups produced by a Backup_Job.
- **Config_Loader**: The startup component of an Application_Service that reads configuration and secrets from the runtime environment and validates required values.
- **Required_Config_Variable**: A configuration or secret value an Application_Service requires to operate in production, including at minimum `DATABASE_URL`, `REDIS_HOST`/`REDIS_PORT`, `ENCRYPTION_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, the OAuth client secrets, and the Object_Storage credentials.
- **Secret_Value**: A sensitive configuration value such as a password, API key, OAuth client secret, JWT secret, encryption key, or storage credential.
- **Secret_Source**: The server environment or secret manager that supplies Secret_Values to an Application_Service at runtime.
- **Migration_Step**: A database schema migration applied during deployment using `prisma migrate deploy`.
- **Deployment_Run**: A single execution of the CI_CD_Pipeline that publishes and deploys a specific Container_Image to a target environment.
- **Staging_Environment**: The pre-production target environment that receives a Deployment_Run before Production_Environment.
- **Production_Environment**: The live target environment serving End_Users.
- **Promoted_Artifact**: The single Container_Image, identified by commit SHA, that is deployed to Staging_Environment and then to Production_Environment without rebuilding.
- **Smoke_Test**: The automated post-deploy check that exercises the critical path (authenticated login, creation of a scheduled post, and the health/readiness/version endpoints) against a deployed environment.
- **Rollback**: The action of returning a target environment to the last previously deployed Container_Image.
- **Health_Endpoint**: An HTTP endpoint exposed by API_Service reporting service status; specifically the liveness, readiness, and version endpoints.
- **Liveness_Status**: The result reported by the liveness Health_Endpoint indicating the process is running.
- **Readiness_Status**: The result reported by the readiness Health_Endpoint indicating the service can serve traffic, including verified connectivity to its required Data_Services.
- **Version_Info**: A JSON object reported by a Health_Endpoint containing at least the deployed commit SHA and build identifier.
- **Publish_Job**: A queued BullMQ job whose purpose is to publish a scheduled post to an external platform (Facebook, YouTube, or TikTok).
- **Sync_Job**: A queued BullMQ job that performs analytics synchronization or inbox synchronization on a schedule.
- **Dead_Letter_Store**: The durable record where a Publish_Job or Sync_Job that has exhausted its retries is placed for later inspection.
- **Alert**: A notification sent to an Operator when a monitored condition crosses a defined threshold.
- **End_User**: A customer who accesses the SaaS through a browser or the Desktop_Client.
- **Operator**: A person who administers the Deployment_System.
- **Deploy_Audit_Record**: The record the CI_CD_Pipeline stores for each Deployment_Run linking the deployed Container_Image to the commit SHA, semantic version, target environment, and timestamp.
- **Tenant_Isolation_Gate**: The launch precondition requiring the `workspace-authorization` spec to be implemented and verified before public production launch.

## Requirements

### Requirement 1: Reproducible, hardened containerized builds

**User Story:** As an operator, I want each application built into a reproducible, hardened container image, so that production runs the same artifact every time without host secrets or surprises.

#### Acceptance Criteria

1. THE Build_Pipeline SHALL produce a Container_Image for each of API_Service, Web_Service, and Worker_Service from the monorepo source.
2. THE Build_Pipeline SHALL build each Container_Image using a multi-stage Dockerfile that excludes build-time development dependencies from the final runtime image.
3. THE Build_Pipeline SHALL pin every base image referenced in each Dockerfile to a specific version tag or digest rather than a floating `latest` tag.
4. WHERE a Container_Image defines its runtime process, THE Build_Pipeline SHALL configure that image to run the Application_Service as a non-root user.
5. THE Build_Pipeline SHALL exclude every Secret_Value from each Container_Image so that no Secret_Value is stored in an image layer or build argument retained in the image.
6. WHEN the same commit SHA is built more than once, THE Build_Pipeline SHALL produce Container_Images whose application contents are equivalent for that commit SHA.
7. THE Build_Pipeline SHALL embed the commit SHA and build identifier in each Container_Image so that the running Application_Service reports its Version_Info.
8. THE Build_Pipeline SHALL define a container healthcheck for API_Service and Web_Service that reports container health based on an HTTP request to a Health_Endpoint.

### Requirement 2: Same artifact promoted across environments

**User Story:** As an operator, I want the exact image tested in staging to be the one that runs in production, so that production behavior matches what was verified.

#### Acceptance Criteria

1. WHEN the CI_CD_Pipeline publishes a Container_Image, THE CI_CD_Pipeline SHALL tag the image with both the commit SHA and a semantic version.
2. WHEN the CI_CD_Pipeline deploys to Staging_Environment and later to Production_Environment for the same Deployment_Run, THE CI_CD_Pipeline SHALL deploy the same Promoted_Artifact to both environments without rebuilding the Container_Image.
3. THE CI_CD_Pipeline SHALL configure each target environment solely through runtime configuration and Secret_Values supplied at deploy time, and SHALL NOT vary the Promoted_Artifact contents between Staging_Environment and Production_Environment.
4. WHEN the CI_CD_Pipeline deploys a Promoted_Artifact, THE CI_CD_Pipeline SHALL pull that image from the Image_Registry by its commit SHA tag.

### Requirement 3: 24/7 hosted background worker and queue

**User Story:** As a workspace owner, I want scheduled posts and sync jobs to run on the server around the clock, so that my content publishes on time even when my computer is off.

#### Acceptance Criteria

1. THE Worker_Service SHALL run as a managed server-side service that processes Publish_Jobs and Sync_Jobs continuously, independent of any End_User device being powered on or connected.
2. WHERE the Worker_Service process exits or crashes, THE Deployment_System SHALL restart the Worker_Service automatically.
3. WHEN a scheduled post reaches its scheduled time, THE Worker_Service SHALL process the corresponding Publish_Job and attempt publication to the target platform.
4. WHEN a Publish_Job fails a publication attempt, THE Worker_Service SHALL retry the Publish_Job up to its configured maximum retry count using a backoff delay between attempts.
5. IF a Publish_Job exhausts its configured maximum retry count, THEN THE Worker_Service SHALL move the Publish_Job to the Dead_Letter_Store and SHALL record the failure reason.
6. THE Redis_Service SHALL run as a managed server-side service with on-disk persistence so that queued Publish_Jobs and Sync_Jobs survive a Redis_Service restart.
7. WHEN Redis_Service restarts, THE Deployment_System SHALL retain previously queued Publish_Jobs and Sync_Jobs so that scheduled work is not lost.
8. THE Worker_Service SHALL run token-refresh jobs on the server on their schedule so that platform credentials are refreshed without End_User interaction.

### Requirement 4: Public HTTPS access on a real domain

**User Story:** As an end user, I want to reach the product securely at a real domain in my browser, so that I can use it from anywhere without any local setup.

#### Acceptance Criteria

1. THE Reverse_Proxy SHALL route external requests for the configured web hostname to Web_Service and external requests for the configured API hostname to API_Service.
2. THE Reverse_Proxy SHALL serve external traffic over HTTPS using a TLS_Certificate for the configured domain.
3. WHEN an external client requests the site over HTTP, THE Reverse_Proxy SHALL redirect the client to the HTTPS equivalent of the requested URL.
4. WHERE the application uses WebSocket or long-poll connections, THE Reverse_Proxy SHALL forward connection-upgrade requests so that those connections succeed.
5. THE Reverse_Proxy SHALL forward the original client host and protocol to API_Service and Web_Service so that the applications construct correct external URLs.
6. THE Deployment_System SHALL restrict externally reachable ports to those served through the Reverse_Proxy, and SHALL NOT expose Data_Service ports to the public internet.

### Requirement 5: Automatic TLS provisioning, renewal, and expired-certificate recovery

**User Story:** As an operator, I want certificates obtained, renewed, and recovered automatically even after expiry, so that the site stays reachable over HTTPS without manual intervention.

#### Acceptance Criteria

1. WHEN the Deployment_System first starts for a configured domain that has no TLS_Certificate, THE TLS_Manager SHALL obtain a TLS_Certificate from the ACME certificate authority for that domain.
2. THE TLS_Manager SHALL renew the TLS_Certificate automatically before its expiry date.
3. IF the TLS_Certificate for the configured domain has already expired, THEN THE TLS_Manager SHALL attempt to obtain a new TLS_Certificate and SHALL restore HTTPS service for that domain without requiring manual operator intervention.
4. IF an attempt to obtain or renew a TLS_Certificate fails, THEN THE TLS_Manager SHALL retry the attempt on a recurring schedule until a valid TLS_Certificate is obtained.
5. WHEN the TLS_Manager obtains or renews a TLS_Certificate, THE Reverse_Proxy SHALL begin serving the new TLS_Certificate without a manual restart by an Operator.
6. THE TLS_Manager SHALL store obtained TLS_Certificates and ACME account data on a persistent volume so that certificates and renewal state survive a Reverse_Proxy restart or recreation.

### Requirement 6: Runtime secrets and configuration management

**User Story:** As a security engineer, I want production secrets supplied at runtime from the server and never shipped to clients, so that no secret is committed, baked into an image, or exposed to End_Users.

#### Acceptance Criteria

1. THE Config_Loader SHALL read all Required_Config_Variables and Secret_Values from the Secret_Source at runtime.
2. IF any Required_Config_Variable is absent or empty when an Application_Service starts, THEN THE Config_Loader SHALL terminate startup with a non-zero exit and SHALL record which Required_Config_Variable was absent or empty.
3. WHEN an Application_Service logs configuration at startup, THE Config_Loader SHALL exclude the values of Secret_Values from the log output.
4. THE Deployment_System SHALL deliver Secret_Values only to server-side Application_Services and SHALL NOT include any Secret_Value in content served to the Web_Service browser client or the Desktop_Client.
5. THE Deployment_System SHALL maintain production configuration separately from development configuration so that production values are never sourced from development defaults.
6. THE Deployment_System SHALL configure the API_Service CORS allowlist and external URLs to the production domains rather than localhost values.
7. THE Deployment_System SHALL keep Secret_Values out of version control so that no Secret_Value is committed to the repository.

### Requirement 7: Safe database migrations on deploy

**User Story:** As an operator, I want schema migrations applied automatically and safely during each deploy, so that the database matches the deployed code without data loss or downtime.

#### Acceptance Criteria

1. WHEN a Deployment_Run deploys a Container_Image to a target environment, THE Deployment_System SHALL apply pending Migration_Steps using `prisma migrate deploy` before API_Service begins serving traffic from the new image.
2. THE Deployment_System SHALL apply Migration_Steps in forward-only order and SHALL author each Migration_Step to remain backward-compatible with the previously deployed Container_Image so that a Rollback does not require a destructive schema change.
3. IF a Migration_Step fails during a Deployment_Run, THEN THE Deployment_System SHALL stop the Deployment_Run and SHALL retain the previously running Container_Image as the serving version.
4. WHEN a Deployment_Run applies a Migration_Step that has already been applied, THE Deployment_System SHALL leave the schema unchanged for that already-applied step.
5. WHILE a Migration_Step is being applied, THE Deployment_System SHALL keep the previously deployed API_Service serving requests until the new image is ready to receive traffic.
6. THE Deployment_System SHALL apply Migration_Steps without dropping a column or table that the previously deployed Container_Image still reads or writes, deferring any such removal to a later Migration_Step after that prior image is retired.

### Requirement 8: Health, readiness, and version endpoints

**User Story:** As an operator, I want liveness, readiness, and version endpoints, so that the platform can check liveness and readiness and confirm exactly what was deployed.

#### Acceptance Criteria

1. THE API_Service SHALL expose a liveness Health_Endpoint that returns a JSON Liveness_Status when the process is running.
2. WHEN every required Data_Service is reachable from API_Service, THE readiness Health_Endpoint SHALL return a JSON Readiness_Status reporting ready.
3. IF a required Data_Service is unreachable from API_Service, THEN the readiness Health_Endpoint SHALL report not-ready with HTTP status 503.
4. THE API_Service SHALL expose Version_Info containing the deployed commit SHA and build identifier as JSON.
5. THE Deployment_System SHALL use the liveness Health_Endpoint to detect a non-responsive API_Service and SHALL use the readiness Health_Endpoint to determine when API_Service may receive traffic after a deploy.

### Requirement 9: CI/CD pipeline with build, test, scan, publish, and deploy

**User Story:** As an operator, I want every change to flow through an automated pipeline that builds, tests, scans, and deploys a single traceable artifact, so that what reaches production is verified and linked to its commit.

#### Acceptance Criteria

1. WHEN a change is pushed to the release branch, THE CI_CD_Pipeline SHALL run the build and the existing automated test suite before producing any Container_Image for deployment.
2. IF the build or the test suite fails, THEN THE CI_CD_Pipeline SHALL stop the Deployment_Run and SHALL NOT publish or deploy a Container_Image.
3. THE CI_CD_Pipeline SHALL scan each Container_Image for known vulnerabilities before publishing the image to the Image_Registry.
4. IF an image vulnerability scan reports a vulnerability at or above the configured severity threshold, THEN THE CI_CD_Pipeline SHALL fail the Deployment_Run and SHALL NOT deploy that Container_Image.
5. WHEN the CI_CD_Pipeline completes a Deployment_Run for a target environment, THE CI_CD_Pipeline SHALL store a Deploy_Audit_Record linking the deployed Container_Image to its commit SHA, semantic version, target environment, and timestamp.
6. THE CI_CD_Pipeline SHALL deploy to Staging_Environment before Production_Environment within a Deployment_Run.

### Requirement 10: Post-deploy smoke test and safe rollback

**User Story:** As an operator, I want each deploy verified on the critical path and reversible, so that a bad release is caught and undone quickly.

#### Acceptance Criteria

1. WHEN a Deployment_Run completes a deploy to a target environment, THE Smoke_Test SHALL exercise the critical path consisting of an authenticated login, creation of a scheduled post, and the liveness, readiness, and version Health_Endpoints.
2. IF the Smoke_Test fails against Production_Environment, THEN THE Deployment_System SHALL perform a Rollback to the last previously deployed Container_Image or SHALL follow the documented rollback procedure.
3. WHEN a Rollback completes, THE Deployment_System SHALL serve traffic from the last previously deployed Container_Image.
4. WHEN a Rollback to a prior Container_Image occurs, THE Deployment_System SHALL keep the database schema compatible with that prior Container_Image, consistent with the backward-compatible migration policy of Requirement 7.
5. THE Deployment_System SHALL provide a documented rollback procedure that an Operator can execute to return Production_Environment to a prior Container_Image.

### Requirement 11: Hosted object storage for media

**User Story:** As an end user, I want my uploaded media stored and served by the hosted service, so that my media is available from anywhere and never depends on a developer's local machine.

#### Acceptance Criteria

1. THE Deployment_System SHALL provide Object_Storage that is reachable by API_Service and Worker_Service in the Production_Environment.
2. THE Deployment_System SHALL store uploaded media in Object_Storage on durable storage that retains objects across container restarts and recreations.
3. WHEN an authenticated End_User requests an uploaded media object, THE Deployment_System SHALL serve that object through API_Service or through a Signed_URL referencing Object_Storage, and SHALL NOT serve it from an End_User's local disk or a developer localhost address.
4. WHERE the Deployment_System serves a media object through a Signed_URL, THE Signed_URL SHALL grant read access that expires after a configured duration.
5. THE Deployment_System SHALL configure Object_Storage endpoints and credentials from the Secret_Source at runtime rather than from development defaults.

### Requirement 12: Observability and deploy auditing

**User Story:** As an operator, I want structured logs, error monitoring, basic metrics, and per-deploy audit records, so that I can detect problems and know exactly what is running.

#### Acceptance Criteria

1. THE Application_Services SHALL emit structured logs for HTTP requests and for job processing outcomes.
2. WHEN an Application_Service encounters an unhandled error, THE Deployment_System SHALL record the error in an error-monitoring destination.
3. THE Deployment_System SHALL collect metrics that include application error rate and Publish_Job failure count.
4. WHEN the application error rate exceeds its configured threshold over the configured window, THE Deployment_System SHALL raise an Alert.
5. WHEN a Publish_Job or Sync_Job is moved to the Dead_Letter_Store, THE Deployment_System SHALL raise an Alert.
6. THE Deployment_System SHALL make each Deploy_Audit_Record available to an Operator so that every running deployment is traceable to a commit SHA.
7. WHEN an Application_Service writes a structured log entry, THE Application_Service SHALL exclude Secret_Values and decrypted platform tokens from the log entry.

### Requirement 13: Backups and documented restore

**User Story:** As a workspace owner, I want the database and media backed up with a tested restore path, so that my data survives failures and operator mistakes.

#### Acceptance Criteria

1. THE Backup_Job SHALL produce a backup of Postgres_Service on a daily schedule.
2. THE Backup_Job SHALL produce a backup of Object_Storage media on a defined schedule.
3. THE Backup_Job SHALL retain backups for a defined retention period of at least 7 days and SHALL remove backups older than the retention period.
4. WHEN an Operator performs the Restore_Procedure against an empty Postgres_Service using a backup produced by the Backup_Job, THE Deployment_System SHALL restore the database to the state captured in that backup.
5. WHEN an Operator performs the Restore_Procedure for Object_Storage using a media backup produced by the Backup_Job, THE Deployment_System SHALL restore the media objects captured in that backup.
6. IF a Backup_Job fails to produce a backup, THEN THE Deployment_System SHALL record the failure and SHALL raise an Alert.
7. THE Deployment_System SHALL provide a documented Restore_Procedure covering both Postgres_Service and Object_Storage.

### Requirement 14: Zero-local-setup onboarding

**User Story:** As an end user, I want to sign up and start using the product in my browser with nothing to install, so that I can get going immediately.

#### Acceptance Criteria

1. WHEN an End_User navigates to the production web hostname in a browser, THE Deployment_System SHALL serve the Web_Service UI without requiring the End_User to install Docker, the monorepo, or any local service.
2. WHEN an End_User completes sign-up or login through the browser, THE Deployment_System SHALL grant access to the product backed by the hosted API_Service and Data_Services.
3. WHERE the Desktop_Client is offered, THE Deployment_System SHALL configure the Desktop_Client as a thin shell that loads a configurable hosted server URL rather than spawning Application_Services from a local monorepo checkout.
4. WHEN an Operator or End_User configures the Desktop_Client server URL, THE Desktop_Client SHALL connect to the configured hosted server URL for all product operations.
5. THE Deployment_System SHALL enable an End_User to use scheduled publishing without running any Data_Service, the Worker_Service, or the monorepo on the End_User's device.

### Requirement 15: Tenant isolation and security gate at launch

**User Story:** As a workspace owner, I want tenant isolation proven and the service hardened before it goes public, so that other customers cannot read or change my data.

#### Acceptance Criteria

1. THE Deployment_System SHALL treat the Tenant_Isolation_Gate as a precondition and SHALL NOT launch the Production_Environment to the public until the `workspace-authorization` spec is implemented and verified.
2. THE API_Service SHALL enforce its security middleware (Helmet headers, the CORS allowlist, and request rate limiting) in the Production_Environment.
3. THE Deployment_System SHALL serve the API documentation UI only in non-production environments and SHALL exclude it from the Production_Environment.
4. THE Deployment_System SHALL require authentication for administrative interfaces, including the queue dashboard, so that they are not publicly accessible in the Production_Environment.
5. THE Deployment_System SHALL store at-rest Secret_Values, including encrypted platform tokens, using the existing AES-256-GCM encryption with the production `ENCRYPTION_KEY` supplied from the Secret_Source at runtime.
6. THE Deployment_System SHALL provide a documented incident response playbook covering Rollback of a bad deploy and the Restore_Procedure for Postgres_Service and Object_Storage.
