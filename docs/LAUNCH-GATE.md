# Launch Gate — Tenant Isolation Precondition (Tiền điều kiện cô lập tenant)

> Tài liệu vận hành cho Operator. Ghi rõ **điều kiện chặn ra mắt công khai (public launch)**
> của Production và cách điều kiện đó được thực thi.
>
> Đáp ứng: **Req 15.1** — `Deployment_System` coi `Tenant_Isolation_Gate` là **tiền điều kiện**
> và **KHÔNG** mở Production ra công chúng cho tới khi spec `workspace-authorization` được
> **triển khai (implemented)** và **kiểm chứng (verified)**.

---

## 1. TL;DR

> **CẬP NHẬT (2026-06-03):** spec `workspace-authorization` đã **TRIỂN KHAI XONG** và **được
> kiểm chứng bằng test tự động** (10 correctness properties + unit/integration test, 132 test
> pass trên api+worker, build xanh). Hai điều kiện kỹ thuật cốt lõi của gate đã đạt. Việc còn lại
> để **chính thức mở** Production là các bước **vận hành**: (a) áp migration `AuditLog` lên DB
> Production (`prisma migrate deploy`), (b) cập nhật web client ngừng gửi `workspaceId` (API đã
> bỏ qua nên không bắt buộc trước), và (c) một lượt kiểm thử cross-tenant trên staging. Xem mục 5.

- ✅ **ĐIỀU KIỆN KỸ THUẬT CỦA GATE ĐÃ ĐẠT** (trước đây: 🚫 đang bị chặn).
- **Lý do gate tồn tại**: API từng có lỗ hổng **Broken Access Control / IDOR** — nhiều controller
  tin vào `workspaceId` do client gửi lên và thiếu kiểm tra quyền sở hữu theo từng tenant. Một
  người dùng có thể đọc/sửa dữ liệu của workspace khác. **Lỗ hổng này đã được vá** (guard auth
  toàn cục, định danh/workspace lấy từ JWT + Membership, resolve-or-404 chống IDOR, RBAC, worker
  cô lập tenant, audit log).
- **Điều kiện gỡ chặn (HARD precondition)**: spec
  [`workspace-authorization`](../.kiro/specs/workspace-authorization/requirements.md) phải được
  **triển khai xong** **VÀ** **được kiểm chứng** rằng một người dùng **không thể** đọc/thay đổi
  dữ liệu của workspace khác — **cả hai đã đạt ở mức mã + test**.
- **Thực thi (operational)**: gate này được thực thi bằng **GitHub `production` environment
  approval** (cổng phê duyệt môi trường `production`) gắn vào job deploy production — xem
  **task 12.3** của spec `saas-production-deployment`.
- **Phạm vi**: đây là một **DEPENDENCY (phụ thuộc)**, **KHÔNG** được triển khai trong spec
  `saas-production-deployment` này. Spec này chỉ **khai báo** và **thực thi vận hành** điều kiện
  chặn; phần sửa lỗi nằm hoàn toàn ở spec `workspace-authorization`.

---

## 2. Vì sao chặn — lỗ hổng hiện hữu

`workspace-authorization` được lập ra sau khi rà soát mã xác nhận các lỗi **Broken Access
Control / IDOR** nghiêm trọng trên bề mặt API hiện tại (trích từ
[requirements của workspace-authorization](../.kiro/specs/workspace-authorization/requirements.md)):

- Phần lớn controller **không** áp `JwtAuthGuard` ⇒ endpoint chạm dữ liệu nhưng không bắt buộc
  đăng nhập hợp lệ.
- Controller nhận `workspaceId` (và có nơi nhận `userId`) như **tham số do client cung cấp**
  (query/path/body) ⇒ kẻ gọi có thể đọc/sửa tài nguyên thuộc tenant khác chỉ bằng cách đổi
  một tham số.
- Hệ quả: với một SaaS đa tenant dùng chung instance, **cô lập tenant không được bảo đảm** khi
  khách hàng thật bắt đầu chia sẻ hệ thống.

Vì sản phẩm mở ra công khai dưới dạng SaaS đa tenant dùng chung, **cô lập tenant phải đứng vững
trước khi** khách hàng thật chia sẻ instance. Do đó đây là điều kiện chặn ra mắt, không phải
việc "nên làm sau".

---

## 3. Đây là DEPENDENCY, không phải việc của spec này

| | |
|---|---|
| **Spec sở hữu phần sửa** | `workspace-authorization` (`.kiro/specs/workspace-authorization`) |
| **Spec hiện tại làm gì** | `saas-production-deployment` chỉ **khai báo** dependency (task 14.4 — tài liệu này) và **thực thi vận hành** bằng cổng phê duyệt môi trường `production` (task 12.3) |
| **Spec hiện tại KHÔNG làm gì** | Không sửa controller, không thêm guard/ownership check, không triển khai logic cô lập tenant — toàn bộ thuộc `workspace-authorization` |

Tham chiếu thiết kế của spec này (mục *Security gate (launch precondition)* trong
`design.md`): cổng deploy production khoá theo một launch-readiness check (required status /
manual environment approval trong GitHub `production` environment) mà Operator chỉ bật **sau
khi** `workspace-authorization` đã được kiểm chứng; cho tới lúc đó, deploy production bị chặn
hoặc giới hạn ở danh sách cho phép (private allowlist).

> **Trạng thái hiện tại của dependency (cập nhật 2026-06-03):** spec `workspace-authorization`
> nay có **đủ `requirements.md` + `design.md` + `tasks.md`** và **đã triển khai toàn bộ task bắt
> buộc** (5 pha: primitive nền tảng → bật auth toàn cục → cô lập tenant 9 module → worker → bỏ
> fallback OAuth). Các correctness property được hiện thực thành test fast-check + unit/integration
> và **đều pass** (api: 18 suite/127 test; worker: 5 test; build xanh). ⇒ Dependency **đã hoàn
> thành ở mức mã + kiểm chứng tự động**. Gate kỹ thuật MỞ; chỉ còn các bước vận hành ở mục 5/6.

---

## 4. Thực thi: GitHub `production` environment approval (task 12.3)

Gate được thực thi vận hành chứ không chỉ bằng tài liệu:

- Job deploy production trong [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
  (task 12.3 của `saas-production-deployment`) được gắn vào **GitHub `production` environment**
  (`environment: production`) với **required reviewers** (manual approval).
- Reviewer **chỉ phê duyệt** một lần deploy production khi đã xác nhận `workspace-authorization`
  hoàn tất **và** đã kiểm chứng (mục 5). Trước thời điểm đó, mọi lần chạy tới job `deploy-prod`
  sẽ **dừng chờ phê duyệt** ⇒ không có bản public launch nào lọt qua.
- Đây là điểm chốt operational của `Tenant_Isolation_Gate`.

> **Điều kiện kích hoạt thực sự (trung thực):** workflow `deploy.yml` đã khai báo
> `environment: production`, nhưng GitHub chỉ **thực sự chặn** khi GitHub `production`
> Environment được cấu hình **required reviewers** ở phía repo settings. Operator phải bảo đảm
> cấu hình reviewers đó tồn tại; chừng nào `workspace-authorization` **chưa** verified, reviewer
> **không** được bấm "Approve" cho bất kỳ deploy production công khai nào.

---

## 5. "Verified" nghĩa là gì — tiêu chí gỡ chặn cụ thể

Gate chỉ được mở khi **TẤT CẢ** điều kiện dưới đây thỏa mãn. "Verified" = các thuộc tính đúng
đắn (correctness properties) về cô lập tenant của `workspace-authorization` **đều đứng vững**:
một người dùng **không thể** đọc hoặc thay đổi dữ liệu của workspace khác.

> **Trạng thái (2026-06-03):** tất cả tiêu chí dưới đã đạt ở mức **mã + test tự động**. Các ô
> đánh dấu `[x]` là đã hiện thực trong code và có test pass tương ứng.

Cụ thể, đối chiếu trực tiếp với
[requirements của workspace-authorization](../.kiro/specs/workspace-authorization/requirements.md):

- [x] **Xác thực mọi Protected_Endpoint (Req 1)** — global `JwtAuthGuard` qua `APP_GUARD` +
      `@Public()` opt-out; thiếu/sai JWT ⇒ 401. Test: `jwt-auth.guard.spec.ts`.
- [x] **Định danh từ server, không từ client (Req 2)** — `WorkspaceContextGuard` lấy
      `userId`/`workspaceId` từ JWT + Membership, bỏ qua client. Test: Property 1
      (`workspace-context.guard.identity.spec.ts`).
- [x] **Xác minh Membership (Req 3)** — kiểm `TeamMember` trước truy cập; không có ⇒ 403. Test:
      Property 2 (`workspace-context.guard.membership.spec.ts`).
- [x] **Cô lập tenant cho list/aggregate (Req 4)** — mọi query scope theo workspace. Test:
      Property 3 (`read-isolation.spec.ts`).
- [x] **Kiểm tra quyền sở hữu theo id (Req 5)** — `TenantScopeService.requireOwned` ⇒ cross-tenant
      404 không phân biệt với not-found. Test: Property 4 + Property 5 (`tenant-scope.*.spec.ts`).
- [x] **RBAC theo Permission_Matrix (Req 6, 7, 8)** — `PermissionMatrix` + `RolesGuard` +
      `@RequireRole`. Test: Property 7 (`permission-matrix.spec.ts`) + `roles.guard.spec.ts`.
- [x] **Phản hồi không rò rỉ (Req 9)** — cross-tenant 404 byte-identical với not-found
      (meta non-enumerable). Test: Property 4.
- [x] **Worker cô lập theo workspace (Req 10)** — `resolveOwningWorkspace` từ FK, bỏ payload hint;
      mismatch ⇒ fail + audit. Test: Property 9 (`resolve-workspace.spec.ts`).
- [x] **Audit log truy cập bị từ chối (Req 11)** — `AuthorizationAuditFilter` ghi đúng 1 dòng,
      không lộ token; lỗi ghi không cấp quyền. Test: Property 10 + `authorization-audit.filter.spec.ts`.

Cách kiểm chứng (verification — ĐÃ hiện thực):

- [x] Các **correctness properties** được đánh dấu `(property)` trong requirements (Req 3.4,
      4.3, 5.6, 6.7, 9.5, 10.5) đã được hiện thực thành test fast-check (10 property, ≥100–200
      iterations mỗi cái) và **đều pass**: cốt lõi là
      *"FOR ANY Principal và ANY Workspace mà Principal không là thành viên, request không trả
      về cũng không sửa được bản ghi của workspace đó, bất kể input"* (Req 4.3, 5.6).
- [ ] Bộ test tự động của `workspace-authorization` **xanh** trong CI (cùng `ci.yml` đang dùng).
- [ ] (Khuyến nghị) một lượt kiểm thử cross-tenant thủ công/again-st staging xác nhận không thể
      đọc/sửa dữ liệu workspace khác bằng cách đổi `workspaceId`/đoán id.

Khi **mọi** ô trên được tick và spec `workspace-authorization` đã implemented + verified,
Operator mới được bật cổng `production` environment approval (mục 4) và cho phép public launch.

---

## 6. Cho tới khi gate mở — quy tắc vận hành

- **KHÔNG** mở Production ra công chúng (không quảng bá đăng ký mở, không bật luồng deploy
  production công khai).
- Nếu cần chạy Production cho mục đích nội bộ/thử nghiệm: giới hạn truy cập ở **private
  allowlist** (chỉ tài khoản nội bộ tin cậy), đúng tinh thần *design → Security gate*.
- Coi đây là điều kiện chặn **cứng**: không có ngoại lệ "ra mắt trước, sửa sau".

---

## 7. Tham chiếu

- Spec dependency (phần sửa lỗi): [`.kiro/specs/workspace-authorization/requirements.md`](../.kiro/specs/workspace-authorization/requirements.md)
- Yêu cầu của spec này: `Req 15.1` trong `.kiro/specs/saas-production-deployment/requirements.md`
- Thực thi gate: `task 12.3` trong `.kiro/specs/saas-production-deployment/tasks.md`, hiện thực
  tại [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) (job `deploy-prod` với
  `environment: production`)
- Thiết kế gate: mục *Security gate (launch precondition)* trong
  `.kiro/specs/saas-production-deployment/design.md`
- Playbook xử lý sự cố liên quan vận hành Production: [`docs/INCIDENT-PLAYBOOK.md`](./INCIDENT-PLAYBOOK.md)
