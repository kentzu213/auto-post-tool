# Requirements Document

## Introduction

This feature productionizes the existing "Izzi Auto Post" / Auto-Post Tool (a pnpm + Turborepo monorepo: `apps/api` NestJS, `apps/web` Next.js, `apps/worker` BullMQ consumer, `apps/desktop` Electron launcher) into a commercially hosted, multi-tenant SaaS. The objective is "cài phát chạy ngay" for end users: a customer signs up and uses the product entirely through a browser (or a thin desktop shell pointing at the hosted URL) with zero local installation, no Docker, and no monorepo on their machine. Scheduled publishing to Facebook, YouTube, and TikTok must continue running on the server 24/7, including while the customer's computer is powered off.

The scope of this spec is deployment and productionization, not new product features. It covers reproducible containerized builds, persistent and backed-up data services, public HTTPS access through a reverse proxy on a single VPS (with a documented path to scale), production configuration and secrets management, safe database migrations on deploy, a CI/CD pipeline that builds → tests → scans → publishes a versioned image → deploys to staging then production with smoke tests and rollback, health and observability endpoints with alerting, 24/7 worker reliability with dead-letter handling, and zero-local-setup onboarding.

Because the product is being opened to the public as a multi-tenant SaaS, tenant isolation is non-negotiable at launch. The separate `workspace-authorization` spec (`.kiro/specs/workspace-authorization`) fixes critical Broken Access Control / IDOR defects where controllers lack auth guards and trust client-supplied `workspaceId`. This deployment spec treats completion and verification of `workspace-authorization` as a hard launch gate.

The default target architecture is a single-VPS Docker Compose production deployment (matching the existing `docker-compose.prod.yml` and `DEPLOYMENT.md`), fronted by a reverse proxy with managed TLS, with automated nightly PostgreSQL backups and GitHub Actions for CI/CD. Where the request describes behavior in implementation-neutral terms, this document follows that default unless the existing codebase clearly indicates otherwise.

Out of scope: building new product features; billing/payments implementation (noted as future only); Kubernetes orchestration (single-server first, scale path noted only); external platform API approvals (Meta/Google/TikTok app review) beyond noting them as external prerequisites.

## Glossary

- **Deployment_System**: The complete set of production infrastructure, configuration, and processes defined by this spec that runs the Auto-Post Tool as a hosted SaaS.
- **API_Service**: The containerized NestJS application built from `apps/api`, serving HTTP endpoints in production.
- **Web_Service**: The containerized Next.js application built from `apps/web`, serving the browser UI in production.
- **Worker_Service**: The containerized BullMQ consumer built from `apps/worker` that executes scheduled publishing jobs and token-refresh jobs.
- **Application_Service**: Any one of API_Service, Web_Service, or Worker_Service.
- **Container_Image**: A built Docker image for an Application_Service.
- **Build_Pipeline**: The image build process producing Container_Images for the Application_Services.
- **CI_CD_Pipeline**: The GitHub Actions automation that builds, tests, scans, publishes, and deploys the Deployment_System.
- **Image_Registry**: The container registry that stores published Container_Images, tagged by commit SHA and semantic version.
- **Reverse_Proxy**: The production HTTP front (Nginx with Certbot, or Caddy) that terminates TLS and routes external traffic to Web_Service and API_Service.
- **Postgres_Service**: The production PostgreSQL 16 database instance with a persistent data volume.
- **Redis_Service**: The production Redis 7 instance, used as the BullMQ queue store, configured for persistence.
- **Object_Storage**: The production media store (self-hosted MinIO or a cloud S3-compatible service) holding uploaded media durably.
- **Data_Service**: Any one of Postgres_Service, Redis_Service, or Object_Storage.
- **Backup_Job**: The automated process that produces and stores backups of Postgres_Service.
- **Config_Loader**: The startup component of an Application_Service that reads configuration and secrets from the runtime environment and validates required values.
- **Required_Config_Variable**: A configuration or secret value that an Application_Service requires to operate in production, including at minimum `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `ENCRYPTION_KEY`.
- **Secret_Value**: A sensitive configuration value such as a password, API key, client secret, JWT secret, or encryption key.
- **Migration_Step**: The database schema migration applied during deployment using `prisma migrate deploy`.
- **Deployment_Run**: A single execution of the CI_CD_Pipeline that publishes and deploys a specific Container_Image to a target environment.
- **Staging_Environment**: The pre-production target environment that receives a Deployment_Run before production.
- **Production_Environment**: The live target environment serving end users.
- **Smoke_Test**: The automated post-deploy check that exercises the critical path (login, create a scheduled post, health endpoints) against a deployed environment.
- **Rollback**: The action of returning a target environment to the last previously deployed Container_Image.
- **Health_Endpoint**: An HTTP endpoint exposed by API_Service reporting service status; specifically the liveness, readiness, and version endpoints.
- **Liveness_Status**: The result reported by the liveness Health_Endpoint indicating the process is running.
- **Readiness_Status**: The result reported by the readiness Health_Endpoint indicating the service can serve traffic, including verified connectivity to its required Data_Services.
- **Version_Info**: A JSON object reported by a Health_Endpoint containing at least the deployed commit SHA and build identifier.
- **Publish_Job**: A queued BullMQ job whose purpose is to publish a scheduled post to an external platform (Facebook, YouTube, or TikTok).
- **Dead_Letter_Store**: The durable record where a Publish_Job that has exhausted its retries is placed for later inspection.
- **Outbox_Sweeper**: The existing periodic process that reconciles pending outbox records into queued jobs.
- **Alert**: A notification sent to operators when a monitored condition crosses a defined threshold.
- **End_User**: A customer who accesses the SaaS through a browser or thin desktop shell.
- **Operator**: A person who administers the Deployment_System.
- **Tenant_Isolation_Gate**: The launch condition requiring the `workspace-authorization` spec to be implemented and verified before public production launch.

## Requirements

### Requirement 1: Reproducible containerized builds

**User Story:** As an operator, I want each application built into a reproducible, hardened container image, so that production runs the same artifact every time without surprises.

#### Acceptance Criteria

1. THE Build_Pipeline SHALL produce a Container_Image for each of API_Service, Web_Service, and Worker_Service from the monorepo source.
2. THE Build_Pipeline SHALL build each Container_Image using a multi-stage Dockerfile that excludes build-time development dependencies from the final runtime image.
3. THE Build_Pipeline SHALL pin every base image referenced in each Dockerfile to a specific version tag or digest rather than a floating `latest` tag.
4. WHERE a Container_Image defines its runtime process, THE Build_Pipeline SHALL configure that image to run the Application_Service as a non-root user.
5. THE Build_Pipeline SHALL define a container healthcheck for API_Service and Web_Service that reports container health based on an HTTP request to a Health_Endpoint.
6. WHEN the same commit SHA is built more than once, THE Build_Pipeline SHALL produce Container_Images whose application contents are equivalent for that commit SHA.
7. THE Build_Pipeline SHALL include, in each Container_Image, the commit SHA and build identifier so that the running service can report its Version_Info.

### Requirement 2: Production orchestration on a single server with a scale path

**User Story:** As an operator, I want all services orchestrated together on one VPS, so that I can launch and operate the whole system with one command while keeping a route to scale later.

#### Acceptance Criteria

1. THE Deployment_System SHALL define a production orchestration configuration that starts API_Service, Web_Service, Worker_Service, Postgres_Service, Redis_Service, and Object_Storage as managed services on a single server.
2. WHERE a service in the production orchestration exits or crashes, THE Deployment_System SHALL restart that service automatically.
3. THE Deployment_System SHALL connect the Application_Services to their Data_Services over a private internal network that is not exposed to the public internet.
4. THE Deployment_System SHALL restrict externally published ports to those served through the Reverse_Proxy.
5. WHEN an Operator starts the production orchestration, THE Deployment_System SHALL bring up the services in an order that satisfies each service's declared dependencies on Data_Services.
6. THE Deployment_System SHALL document the path to scale beyond a single server, identifying which services are stateless and may run as multiple replicas and which services hold state.

### Requirement 3: Persistent and backed-up data services

**User Story:** As a workspace owner, I want my data stored durably and backed up, so that my posts, accounts, and media survive restarts, failures, and operator mistakes.

#### Acceptance Criteria

1. THE Deployment_System SHALL store Postgres_Service data on a persistent volume that retains data across container restarts and recreations.
2. THE Deployment_System SHALL configure Redis_Service with on-disk persistence so that queued jobs survive a Redis_Service restart.
3. THE Deployment_System SHALL store media in Object_Storage on durable storage that retains objects across container restarts and recreations.
4. THE Backup_Job SHALL produce a backup of Postgres_Service on a daily schedule.
5. THE Backup_Job SHALL retain Postgres_Service backups for a defined retention period of at least 7 days and SHALL remove backups older than the retention period.
6. WHEN an Operator performs the documented restore procedure against an empty Postgres_Service using a backup produced by the Backup_Job, THE Deployment_System SHALL restore the database to the state captured in that backup.
7. IF a Backup_Job fails to produce a backup, THEN THE Deployment_System SHALL record the failure and SHALL raise an Alert.

### Requirement 4: Public HTTPS access through a reverse proxy

**User Story:** As an end user, I want to reach the product securely at a custom domain in my browser, so that I can use it from anywhere without any local setup.

#### Acceptance Criteria

1. THE Reverse_Proxy SHALL route external requests for the configured web hostname to Web_Service and external requests for the configured API hostname to API_Service.
2. THE Reverse_Proxy SHALL serve external traffic over HTTPS using a TLS certificate for the configured domain.
3. WHEN an external client requests the site over HTTP, THE Reverse_Proxy SHALL redirect the client to the HTTPS equivalent of the requested URL.
4. THE Deployment_System SHALL obtain and renew the TLS certificate automatically before expiry.
5. WHERE the application uses WebSocket or long-poll connections, THE Reverse_Proxy SHALL forward connection-upgrade requests so that those connections succeed.
6. THE Reverse_Proxy SHALL forward the original client host and protocol to API_Service and Web_Service so that the applications construct correct external URLs.

### Requirement 5: Production configuration and secrets management

**User Story:** As a security engineer, I want production secrets supplied at runtime and required values enforced at startup, so that no secret is baked into an image and a misconfigured service fails fast instead of running insecurely.

#### Acceptance Criteria

1. THE Config_Loader SHALL read all Required_Config_Variables and Secret_Values from the runtime environment of the Application_Service.
2. THE Build_Pipeline SHALL exclude Secret_Values from every Container_Image so that no Secret_Value is stored in an image layer.
3. IF any Required_Config_Variable is absent or empty when an Application_Service starts, THEN THE Config_Loader SHALL terminate startup with a non-zero exit and SHALL record which Required_Config_Variable was absent or empty.
4. WHEN an Application_Service logs configuration at startup, THE Config_Loader SHALL exclude the values of Secret_Values from the log output.
5. THE Deployment_System SHALL maintain production configuration separately from development configuration so that production values are never sourced from development defaults.
6. THE Deployment_System SHALL configure the API_Service CORS allowlist and external URLs to the production domains rather than localhost values.

### Requirement 6: Safe database migrations on deploy

**User Story:** As an operator, I want schema migrations applied automatically and safely during each deploy, so that the database matches the deployed code without manual steps or downtime.

#### Acceptance Criteria

1. WHEN a Deployment_Run deploys a Container_Image to a target environment, THE Deployment_System SHALL apply pending Migration_Steps using `prisma migrate deploy` before API_Service begins serving traffic from the new image.
2. IF a Migration_Step fails during a Deployment_Run, THEN THE Deployment_System SHALL stop the Deployment_Run and SHALL retain the previously running image as the serving version.
3. THE Deployment_System SHALL apply Migration_Steps in forward-only order and SHALL NOT require destructive manual schema edits during a Deployment_Run.
4. WHEN a Deployment_Run applies a Migration_Step that has already been applied, THE Deployment_System SHALL leave the schema unchanged for that already-applied step.
5. WHILE a Migration_Step is being applied, THE Deployment_System SHALL keep the previously deployed API_Service serving requests until the new image is ready to receive traffic.

### Requirement 7: CI/CD build, test, scan, publish, and deploy

**User Story:** As an operator, I want every change to flow through an automated pipeline that builds, tests, scans, and deploys a single traceable artifact, so that what reaches production is verified and linked to its commit.

#### Acceptance Criteria

1. WHEN a change is pushed to the release branch, THE CI_CD_Pipeline SHALL run the build and the existing automated test suite before producing any Container_Image for deployment.
2. IF the build or the test suite fails, THEN THE CI_CD_Pipeline SHALL stop the Deployment_Run and SHALL NOT publish or deploy a Container_Image.
3. THE CI_CD_Pipeline SHALL scan each Container_Image for known vulnerabilities (CVEs) before publishing the image.
4. IF an image vulnerability scan reports a vulnerability at or above the configured severity threshold, THEN THE CI_CD_Pipeline SHALL fail the Deployment_Run and SHALL NOT deploy that Container_Image.
5. WHEN the CI_CD_Pipeline publishes a Container_Image, THE CI_CD_Pipeline SHALL tag the image with both the commit SHA and a semantic version.
6. WHEN the CI_CD_Pipeline deploys to Production_Environment, THE CI_CD_Pipeline SHALL deploy the same Container_Image artifact that was previously deployed to Staging_Environment.
7. THE CI_CD_Pipeline SHALL record, for each Deployment_Run, the commit SHA that produced the deployed Container_Image so that every deployment is traceable to a commit.

### Requirement 8: Post-deploy smoke test and rollback

**User Story:** As an operator, I want each deploy verified on the critical path and reversible, so that a bad release is caught and undone quickly.

#### Acceptance Criteria

1. WHEN a Deployment_Run completes a deploy to a target environment, THE Smoke_Test SHALL exercise the critical path consisting of an authenticated login, creation of a scheduled post, and the liveness and readiness Health_Endpoints.
2. IF the Smoke_Test fails against Production_Environment, THEN THE Deployment_System SHALL perform a Rollback to the last previously deployed Container_Image or SHALL follow the documented rollback procedure.
3. WHEN a Rollback completes, THE Deployment_System SHALL serve traffic from the last previously deployed Container_Image.
4. THE Deployment_System SHALL provide a documented rollback procedure that an Operator can execute to return Production_Environment to a prior Container_Image.
5. WHEN a Rollback to a prior Container_Image occurs, THE Deployment_System SHALL keep the database schema compatible with the prior Container_Image, consistent with the forward-only migration policy of Requirement 6.

### Requirement 9: Health, version, and observability

**User Story:** As an operator, I want liveness, readiness, and version endpoints plus logs and metrics, so that I can confirm a deploy and detect problems.

#### Acceptance Criteria

1. THE API_Service SHALL expose a liveness Health_Endpoint that returns a JSON Liveness_Status when the process is running.
2. THE API_Service SHALL expose a readiness Health_Endpoint that returns a JSON Readiness_Status, and WHEN a required Data_Service is reachable, THE readiness Health_Endpoint SHALL report ready.
3. IF a required Data_Service is unreachable from API_Service, THEN the readiness Health_Endpoint SHALL report not-ready with HTTP status 503.
4. THE API_Service SHALL expose Version_Info containing the deployed commit SHA and build identifier as JSON.
5. THE Application_Services SHALL emit structured logs for requests and for job processing outcomes.
6. THE Deployment_System SHALL collect metrics that include application error rate and Publish_Job failure count.
7. WHEN the application error rate exceeds its configured threshold over the configured window, THE Deployment_System SHALL raise an Alert.
8. WHEN a Publish_Job is moved to the Dead_Letter_Store, THE Deployment_System SHALL raise an Alert.

### Requirement 10: 24/7 scheduled publishing reliability

**User Story:** As a workspace owner, I want scheduled posts to publish on time around the clock from the server, so that my content goes out even when my computer is off.

#### Acceptance Criteria

1. THE Worker_Service SHALL run as a managed service that processes Publish_Jobs continuously, independent of any End_User device being powered on or connected.
2. WHERE the Worker_Service process exits or crashes, THE Deployment_System SHALL restart the Worker_Service automatically.
3. WHEN a scheduled post reaches its scheduled time, THE Worker_Service SHALL process the corresponding Publish_Job and attempt publication to the target platform.
4. WHEN a Publish_Job fails a publication attempt, THE Worker_Service SHALL retry the Publish_Job up to its configured maximum retry count using a backoff delay between attempts.
5. IF a Publish_Job exhausts its configured maximum retry count, THEN THE Worker_Service SHALL move the Publish_Job to the Dead_Letter_Store and SHALL record the failure reason.
6. WHEN Redis_Service restarts, THE Deployment_System SHALL retain previously queued Publish_Jobs so that scheduled work is not lost, consistent with the persistence required by Requirement 3.
7. WHILE the Worker_Service is running, THE Outbox_Sweeper SHALL periodically reconcile pending outbox records into queued Publish_Jobs.
8. THE Worker_Service SHALL run token-refresh jobs on the server on their schedule so that platform credentials are refreshed without End_User interaction.

### Requirement 11: Zero-local-setup onboarding

**User Story:** As an end user, I want to sign up and start using the product in my browser with nothing to install, so that I can get going immediately.

#### Acceptance Criteria

1. WHEN an End_User navigates to the production web hostname in a browser, THE Deployment_System SHALL serve the Web_Service UI without requiring the End_User to install Docker, the monorepo, or any local service.
2. WHEN an End_User completes sign-up or login through the browser, THE Deployment_System SHALL grant access to the product backed by the hosted API_Service and Data_Services.
3. WHERE the Electron desktop application is offered, THE Deployment_System SHALL configure it as a thin shell that loads the hosted production URL rather than running Application_Services locally.
4. THE Deployment_System SHALL serve uploaded media to authenticated End_Users from Object_Storage through the hosted environment rather than from an End_User's local disk.

### Requirement 12: Tenant isolation and security at launch

**User Story:** As a workspace owner, I want my tenant's data isolated and the service secured before it goes public, so that other customers cannot read or change my data.

#### Acceptance Criteria

1. THE Deployment_System SHALL treat the Tenant_Isolation_Gate as a precondition and SHALL NOT launch the Production_Environment to the public until the `workspace-authorization` spec is implemented and verified.
2. THE API_Service SHALL enforce its security middleware (Helmet headers, the CORS allowlist, and request rate limiting) in the Production_Environment.
3. THE Deployment_System SHALL serve the API documentation UI only in non-production environments and SHALL NOT expose it in the Production_Environment.
4. THE Deployment_System SHALL restrict administrative interfaces, including the queue dashboard, so that they are not publicly accessible in the Production_Environment without authentication.
5. THE Deployment_System SHALL store at-rest Secret_Values, including encrypted platform tokens, using the existing AES-256-GCM encryption with the production `ENCRYPTION_KEY` supplied at runtime.
6. THE Deployment_System SHALL provide a documented incident rollback and recovery playbook covering Rollback of a bad deploy and restore of Postgres_Service from a Backup_Job.
