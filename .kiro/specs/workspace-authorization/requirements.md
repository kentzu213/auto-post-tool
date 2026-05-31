# Requirements Document

## Introduction

This feature adds a consistent authorization and multi-tenant isolation layer to the existing
multi-tenant social-media auto-posting SaaS (NestJS API + BullMQ worker + Next.js web). A code
review confirmed serious Broken Access Control / IDOR vulnerabilities: most controllers do not
apply authentication, and they accept `workspaceId` (and in one case `userId`) as client-supplied
query parameters, allowing any caller to read or mutate resources belonging to other tenants.

The goal is to guarantee that every protected request is authenticated, that the workspace and user
identity used for data access are derived from the verified JWT and `TeamMember` membership (never
from client input), that resources accessed by id belong to a workspace the caller is a member of,
and that role-based permissions are enforced consistently. The scope is strictly authorization and
tenant isolation across the existing API surface and the worker where it acts on behalf of a
workspace.

Authentication mechanics (JWT issuance, password hashing, token encryption) already exist and are
reused as-is. This feature does not add refresh-token rotation, 2FA, billing, real analytics data,
or new platform integrations.

## Glossary

- **API**: The NestJS application at `apps/api` that exposes HTTP endpoints.
- **Worker**: The BullMQ background process that executes scheduled jobs (publishing, token refresh) on behalf of a workspace.
- **Principal**: The authenticated user identified by the `sub` claim of a valid JWT.
- **JWT**: The JSON Web Token issued at login, containing claims `{ sub: userId, email, workspaceId }`, validated by the existing passport-jwt strategy.
- **JwtAuthGuard**: The existing NestJS guard that rejects requests lacking a valid JWT.
- **Workspace**: A tenant boundary; all tenant-scoped resources reference a `workspaceId`.
- **TeamMember**: The join record linking a User to a Workspace with a Role; the authoritative source of membership.
- **Membership**: The existence of a TeamMember record for a given (userId, workspaceId) pair.
- **Role**: One of the existing Prisma enum values `owner`, `editor`, `approver`, `viewer`, defined on a TeamMember record.
- **Active_Workspace**: The single Workspace a Principal is operating within for a given request, resolved by the API from the JWT and verified Membership.
- **Tenant_Scoped_Resource**: Any record that is owned by a Workspace directly (SocialAccount, Post, Campaign, Template, HashtagSet, RSSSource, ProviderCredential) or transitively through a parent (Schedule, Analytics, PostVersion, MediaAsset, ApprovalRequest, InboxMessage) by following its foreign keys to a `workspaceId`.
- **User_Scoped_Resource**: A record owned by a specific User rather than a Workspace (Notification).
- **Owning_Workspace**: For a Tenant_Scoped_Resource, the single `workspaceId` reached by resolving the resource's foreign keys.
- **Protected_Endpoint**: Any API HTTP endpoint that reads or mutates a Tenant_Scoped_Resource or User_Scoped_Resource. Excludes public endpoints (login, register, supabase-sync, OAuth callback, health).
- **Mutating_Request**: A request that creates, updates, deletes, publishes, approves, or rejects a resource.
- **Read_Request**: A request that only retrieves resource data without modifying it.
- **Permission_Matrix**: The mapping from (action, Role) to allow/deny defined in Requirement 6.
- **Authorization_Decision**: The allow-or-deny outcome the API computes for a request after authentication, membership, ownership, and role checks.

## Requirements

### Requirement 1: Authentication on all protected endpoints

**User Story:** As a workspace owner, I want every endpoint that touches my data to require a valid login, so that unauthenticated strangers cannot read or change my workspace's resources.

#### Acceptance Criteria

1. WHERE an endpoint is a Protected_Endpoint, THE API SHALL require a valid JWT — one that is well-formed, unexpired, whose signature verifies against the API's signing key, and whose `sub` claim resolves to an existing User — before executing the endpoint handler.
2. IF a request to a Protected_Endpoint omits a JWT, THEN THE API SHALL reject the request with HTTP status 401 and SHALL NOT execute the endpoint handler.
3. IF a request to a Protected_Endpoint presents a JWT that is expired, structurally malformed, or whose signature does not verify against the API's signing key, THEN THE API SHALL reject the request with HTTP status 401 and SHALL NOT execute the endpoint handler.
4. IF a request to a Protected_Endpoint presents a JWT whose `sub` claim does not match an existing User, THEN THE API SHALL reject the request with HTTP status 401 and SHALL NOT execute the endpoint handler.
5. THE API SHALL apply authentication to the posts, analytics, social-auth, campaigns, templates, inbox, notifications, approvals, and media endpoints.
6. WHEN a request to a Protected_Endpoint presents a valid JWT, THE API SHALL execute the endpoint handler.

### Requirement 2: Server-derived principal and workspace identity

**User Story:** As a security engineer, I want the workspace and user identity to come only from the verified token and membership, so that a client cannot impersonate another tenant by changing a query parameter.

#### Acceptance Criteria

1. WHEN the API resolves the Principal for a request, THE API SHALL derive the user identity solely from the JWT `sub` claim and SHALL NOT derive it from any client-supplied query parameter, path parameter, or request body field.
2. WHEN the API resolves the Active_Workspace for a request, THE API SHALL derive the `workspaceId` from the JWT `workspaceId` claim, or from a request-scoped value only after verifying that a TeamMember Membership exists for the (Principal user identity, that workspace) pair, and SHALL NOT derive it from a client-supplied query parameter, path parameter, or request body field.
3. WHERE a request supplies a `workspaceId` value in the query string, path, or body, THE API SHALL ignore that supplied value and proceed using the Active_Workspace derived from the JWT and verified Membership, without returning an error for the mismatch.
4. WHERE a request supplies a `userId` value for a User_Scoped_Resource, THE API SHALL use the Principal user identity and ignore the supplied `userId` value.
5. THE API SHALL expose the validated Principal user identity and verified Membership Role to endpoint handlers for use in data access.
6. IF the API cannot resolve the Active_Workspace from the JWT `workspaceId` claim or from a request-scoped value verified against TeamMember Membership, THEN THE API SHALL reject the request with HTTP status 401 and SHALL NOT perform any data access or mutation.

### Requirement 3: Workspace membership verification

**User Story:** As a workspace owner, I want only my invited team members to access my workspace, so that users outside my team cannot reach my data even when authenticated.

#### Acceptance Criteria

1. WHEN the API determines the Active_Workspace for a request, THE API SHALL verify, against the authoritative TeamMember store and not from JWT claims alone, that a TeamMember record exists for the (Principal user identity, Active_Workspace) pair before the endpoint handler reads or mutates any resource.
2. IF no TeamMember record exists for the (Principal user identity, Active_Workspace) pair, THEN THE API SHALL reject the request with HTTP status 403 and SHALL stop processing the request before any data access or mutation occurs.
3. WHEN the API performs any data access for a Tenant_Scoped_Resource, THE API SHALL scope that access to records whose Owning_Workspace equals the Active_Workspace, and SHALL read or mutate no record whose Owning_Workspace differs from the Active_Workspace.
4. THE API SHALL treat the Active_Workspace as equal to a Workspace for which the Principal holds Membership for every Authorization_Decision. (property)
5. IF the membership verification cannot complete due to an infrastructure failure such as loss of database connectivity, THEN THE API SHALL reject the request with HTTP status 500 and SHALL read or mutate no resource.

### Requirement 4: Tenant isolation for collection and list access

**User Story:** As a workspace member, I want list and aggregate endpoints to return only my workspace's records, so that I never see another tenant's posts, accounts, analytics, or messages.

#### Acceptance Criteria

1. WHEN a Read_Request retrieves a collection of Tenant_Scoped_Resources, THE API SHALL return only records whose Owning_Workspace equals the Active_Workspace, SHALL NOT fall back to returning records belonging to other Workspaces when no workspace filter is otherwise applied, and SHALL return an empty collection when no such records exist.
2. WHEN a Read_Request retrieves aggregated or summary data (analytics dashboard, heatmap, post stats, unread counts), THE API SHALL compute the result only from records whose Owning_Workspace equals the Active_Workspace, and SHALL return a zero-valued or empty aggregate when no such records exist.
3. FOR ANY Principal and ANY Workspace W for which the Principal lacks Membership, a Read_Request from that Principal SHALL return no record whose Owning_Workspace equals W, regardless of query parameter, path, or body values. (property)
4. WHEN a Read_Request for a User_Scoped_Resource collection is received, THE API SHALL return only records owned by the Principal user identity, SHALL NOT fall back to returning records owned by other users, and SHALL return an empty collection when the Principal owns no such records.

### Requirement 5: Resource-level ownership verification

**User Story:** As a workspace member, I want access-by-id requests to be checked against ownership, so that guessing or enumerating another tenant's resource id reveals nothing.

#### Acceptance Criteria

1. WHEN a request references a Tenant_Scoped_Resource by a path id or by a resource-reference parameter (for example `:id`, `postId`, `scheduleId`, account `ids`), THE API SHALL resolve the Owning_Workspace of each referenced resource before reading or mutating that resource.
2. IF the Owning_Workspace of a referenced resource is not equal to the Active_Workspace, THEN THE API SHALL reject the request with HTTP status 404, SHALL NOT read or mutate the referenced resource, and SHALL return a response body identical in shape to the response it returns when a referenced resource id does not match any existing resource.
3. IF a referenced resource id does not match any existing Tenant_Scoped_Resource, THEN THE API SHALL reject the request with HTTP status 404 and SHALL NOT read or mutate any resource.
4. IF ownership resolution cannot complete due to an infrastructure failure such as loss of database connectivity, THEN THE API SHALL reject the request with HTTP status 500 and SHALL NOT read or mutate the referenced resource.
5. WHEN a Mutating_Request references multiple resources by id, THE API SHALL verify, before applying any change, that every referenced resource exists and that the Owning_Workspace of every referenced resource is equal to the Active_Workspace, and SHALL apply no change to any referenced resource if this verification fails for any referenced resource.
6. FOR ANY Principal and ANY Tenant_Scoped_Resource whose Owning_Workspace is a Workspace the Principal is not a member of, a request by that Principal referencing that resource by id SHALL neither return its data nor modify it, regardless of input. (property)
7. WHEN a request creates a Tenant_Scoped_Resource that references a parent resource (for example a Post referencing a SocialAccount or Campaign), THE API SHALL verify, before creating the resource, that each referenced parent exists and that each referenced parent's Owning_Workspace is equal to the Active_Workspace.
8. IF a request to create a Tenant_Scoped_Resource references a parent resource that does not exist or whose Owning_Workspace is not equal to the Active_Workspace, THEN THE API SHALL create no resource and SHALL reject the request with HTTP status 404.

### Requirement 6: Role-based access control

**User Story:** As a workspace owner, I want each role to be limited to the actions it should perform, so that viewers cannot change content and only authorized roles can publish or approve.

#### Acceptance Criteria

1. THE API SHALL enforce a Permission_Matrix in which the `owner` Role is permitted all actions on Tenant_Scoped_Resources within the Active_Workspace.
2. WHERE a Mutating_Request creates or edits content (posts, campaigns, templates, hashtag sets, media, social account connections), THE API SHALL permit the request only for Principals whose Role is `owner` or `editor`.
3. IF a Principal whose Role is `viewer` submits a Mutating_Request, THEN THE API SHALL reject the request with HTTP status 403 and SHALL NOT create, update, delete, publish, approve, or reject any Tenant_Scoped_Resource.
4. WHERE a request approves or rejects an ApprovalRequest, THE API SHALL permit the request only for Principals whose Role is `owner` or `approver`.
5. WHERE a request deletes a Tenant_Scoped_Resource, THE API SHALL permit the request only for Principals whose Role is `owner` or `editor`.
6. WHERE a Mutating_Request publishes a Post, THE API SHALL permit the request only for Principals whose Role is `owner` or `editor`.
7. FOR ANY Protected_Endpoint that performs a mutating action and ANY Principal whose Role is not permitted that action by the Permission_Matrix, the request SHALL be rejected with HTTP status 403 regardless of input, and THE API SHALL NOT create, update, delete, publish, approve, or reject any Tenant_Scoped_Resource. (property)

### Requirement 7: Approval workflow role enforcement

**User Story:** As an approver, I want the approval workflow to respect roles, so that content is reviewed only by users authorized to approve it.

#### Acceptance Criteria

1. WHEN a Principal submits an approval request for a Post whose Owning_Workspace equals the Active_Workspace, THE API SHALL create the ApprovalRequest.
2. IF a Principal submits an approval request for a Post whose Owning_Workspace is not the Active_Workspace, THEN THE API SHALL reject the request with HTTP status 404 and SHALL NOT create the ApprovalRequest.
3. WHERE a Principal reviews (approves or rejects) an ApprovalRequest, THE API SHALL permit the review only for Principals whose Role is `owner` or `approver`.
4. IF a Principal whose Role is `viewer` or `editor` attempts to approve or reject an ApprovalRequest, THEN THE API SHALL reject the request with HTTP status 403.
5. WHEN a Read_Request lists pending approvals, THE API SHALL return only ApprovalRequests whose Post's Owning_Workspace equals the Active_Workspace.

### Requirement 8: Social account connection and disconnection protection

**User Story:** As a workspace owner, I want social account listing, connecting, and disconnecting to be restricted to my authorized team members, so that strangers cannot view my linked accounts, attach tokens to my workspace, or disconnect my accounts.

#### Acceptance Criteria

1. WHEN a Read_Request lists social accounts, THE API SHALL return only SocialAccounts whose Owning_Workspace equals the Active_Workspace, and SHALL NOT fall back to returning accounts across all workspaces.
2. WHEN a request connects a social account (OAuth connect URL, OAuth callback, or direct token connect), THE API SHALL associate the resulting SocialAccount with the Active_Workspace derived from verified Membership.
3. WHERE a request connects a social account, THE API SHALL permit the request only for Principals whose Role is `owner` or `editor`.
4. IF a Principal whose Role is not `owner` or `editor` submits a request to connect a social account, THEN THE API SHALL reject the request with HTTP status 403 and SHALL NOT create or associate any SocialAccount.
5. WHEN a request disconnects one or more social accounts by id, THE API SHALL verify that the Owning_Workspace of every referenced SocialAccount equals the Active_Workspace before deleting any account.
6. WHERE a request disconnects one or more social accounts, THE API SHALL permit the request only for Principals whose Role is `owner` or `editor`.
7. IF a disconnect request references any SocialAccount whose Owning_Workspace is not the Active_Workspace or that does not match any existing SocialAccount, THEN THE API SHALL delete no account and SHALL reject the request with HTTP status 404.

### Requirement 9: Consistent and non-leaking authorization responses

**User Story:** As a security engineer, I want consistent 401 versus 403 semantics that do not reveal whether a resource exists, so that attackers cannot distinguish missing resources from forbidden ones.

#### Acceptance Criteria

1. IF a request fails authentication, THEN THE API SHALL respond with HTTP status 401 and SHALL NOT evaluate Membership, Role, or resource ownership checks.
2. IF an authenticated request fails a Membership or Role check for the Active_Workspace, THEN THE API SHALL respond with HTTP status 403 and SHALL NOT evaluate resource ownership or read or mutate any referenced resource.
3. IF an authenticated and workspace-authorized request references a resource whose Owning_Workspace is not the Active_Workspace, THEN THE API SHALL respond with HTTP status 404 and a response whose HTTP status code and response body content are identical to the response the API returns when the referenced resource does not exist.
4. THE API SHALL exclude resource field values and any response element that indicates whether a referenced resource exists from 401, 403, and cross-tenant 404 responses.
5. FOR ANY Principal and ANY resource id, the API response to a request referencing a Tenant_Scoped_Resource whose Owning_Workspace is not the Active_Workspace SHALL be indistinguishable, in HTTP status code and response body content, from the API response to a request referencing a non-existent resource id. (property)

### Requirement 10: Worker authorization on behalf of a workspace

**User Story:** As a workspace owner, I want background jobs to act only within the workspace that owns the job, so that automated publishing and token refresh cannot cross tenant boundaries.

#### Acceptance Criteria

1. WHEN the Worker processes a job that acts on a Tenant_Scoped_Resource, THE Worker SHALL resolve the Owning_Workspace of the resource from its stored foreign keys.
2. WHEN the Worker reads or mutates resources while processing a job, THE Worker SHALL constrain access to the Owning_Workspace resolved for that job.
3. IF a job references resources whose Owning_Workspace values are not all equal, THEN THE Worker SHALL halt the job without reading or mutating any resource whose Owning_Workspace differs from the job's Owning_Workspace, SHALL mark the job as failed, and SHALL record a failure record that identifies the job and indicates a cross-workspace mismatch.
4. IF the Worker cannot resolve the Owning_Workspace of a resource the job acts on, whether because the resource no longer exists or because of an infrastructure failure such as loss of database connectivity, THEN THE Worker SHALL halt the job without reading or mutating that resource, SHALL mark the job as failed, and SHALL record a failure record that identifies the job and indicates the resolution failure.
5. THE Worker SHALL ignore any client-supplied or job-payload workspace hint and SHALL determine accessible resources solely from server-side resolution of the resource's stored foreign keys. (property)

### Requirement 11: Audit logging of denied access

**User Story:** As a security engineer, I want denied authorization attempts to be recorded, so that I can detect and investigate cross-tenant access attempts.

#### Acceptance Criteria

1. WHEN the API rejects a request with HTTP status 403 due to a failed Membership or Role check, THE API SHALL record exactly one AuditLog entry containing the Principal user identity, the attempted action (the requested operation and target resource type), the Active_Workspace, an indication that the denial was a Membership or Role failure, and the timestamp at which the denial occurred.
2. WHEN the API rejects a request with HTTP status 404 due to a cross-tenant ownership check, THE API SHALL record exactly one AuditLog entry containing the Principal user identity, the attempted action (the requested operation and target resource type), the referenced resource identifier, the Active_Workspace, an indication that the denial was a cross-tenant ownership failure, and the timestamp at which the denial occurred.
3. WHEN the API records an AuditLog entry for a denied request, THE API SHALL exclude decrypted tokens and resource field values from the entry.
4. IF recording an AuditLog entry for a denied request fails, THEN THE API SHALL still return the original rejection response with HTTP status 403 or 404 and SHALL NOT grant access to or return data from the requested resource.
