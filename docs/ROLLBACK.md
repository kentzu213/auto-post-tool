# Rollback_Procedure — Quay Production về một Container_Image trước đó

> Runbook dành cho Operator. Quy trình quay `Production_Environment` trở lại một
> `Container_Image` (artifact) đã chạy tốt trước đó, dùng script `scripts/rollback.sh`.
>
> Đáp ứng: **Req 10.5** (tài liệu rollback Operator có thể tự thực thi). Liên quan:
> **Req 10.2** (xác định và triển khai lại artifact trước), **Req 10.3** (phục vụ traffic từ
> image cũ), **Req 10.4** (schema vẫn tương thích image cũ — không cần thao tác DB phá hủy).
>
> Rollback **tự động** cũng chạy đúng các bước này khi prod smoke test thất bại (task 12.3):
> CI gọi `scripts/rollback.sh`. Runbook này là đường thủ công tương đương khi Operator cần tự làm.

---

## 0. Mô hình rollback (đọc trước khi chạy)

- CI (task 12.1, `.github/workflows/ci.yml`) build sẵn và push 3 image lên GHCR, tag theo
  **full commit SHA**:

  ```text
  ghcr.io/<owner>/autopost-api:sha-<commit>
  ghcr.io/<owner>/autopost-web:sha-<commit>
  ghcr.io/<owner>/autopost-worker:sha-<commit>
  ```

  `<commit>` chính là giá trị nhúng vào image làm `APP_COMMIT_SHA` và trả ra ở `GET /version.commit`.
  Vì vậy **PREV_SHA = full commit SHA** — cùng một chuỗi xuất hiện ở `/version` lẫn ở tag GHCR.

- Rollback = trỏ 3 service `api`/`web`/`worker` sang image `:sha-<PREV_SHA>` rồi `pull` + `up -d`.
  Data services (`postgres`/`redis`/`minio`) và `caddy` **không bị đụng tới**.

- **Không có bước DB phá hủy** (Req 10.4): migration là *forward-only + backward-compatible*
  (xem `docs/RESTORE.md` và design — chính sách expand → migrate → contract). Schema mà image cũ
  cần luôn là tập con của schema đang áp, nên quay về image cũ là an toàn mà không cần `migrate`
  ngược hay drop cột/bảng.

---

## 1. Yêu cầu trước khi bắt đầu (Prerequisites)

- Quyền SSH vào VPS Production và quyền chạy `docker compose`.
- Trên VPS có: repo checkout chứa `docker-compose.prod.yml`, file `.env` Production
  (root-owned, `chmod 600`, **không** trong git), và `scripts/rollback.sh`.
- Đã đăng nhập GHCR để `docker compose pull` kéo được image private (nếu package ở chế độ private):

  ```bash
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "<github-user>" --password-stdin
  ```

- Công cụ trên host: `docker` (kèm `docker compose`), `curl`. Khuyến nghị có `jq` (script vẫn
  chạy được không cần `jq` — có sẵn fallback parse JSON bằng `sed`).
- Biến/secret luôn ở dạng placeholder `${VAR}` — **không** điền giá trị thật vào tài liệu này.

> Đặt sẵn biến tiện dụng cho cả phiên:
> ```bash
> COMPOSE="docker compose -f docker-compose.prod.yml"
> ```

---

## 2. Tìm SHA tốt trước đó (PREV_SHA)

Có 2 nguồn; ưu tiên Deploy_Audit_Record, đối chiếu với tag GHCR.

### 2.1 Từ Deploy_Audit_Record (nguồn chính)

Deploy workflow (task 12.3) ghi mỗi lần deploy thành công một dòng JSON vào audit log
(JSONL, mặc định `/var/log/autopost/deploys.jsonl`):

```text
{"commit":"<sha>","semver":"x.y.z","env":"production","timestamp":"…","result":"success", …}
```

Liệt kê vài bản ghi `success` gần nhất của `production` để chọn artifact tốt **trước** bản đang lỗi:

```bash
# Có jq (đẹp + chắc chắn):
tail -n 50 /var/log/autopost/deploys.jsonl \
  | jq -r 'select(.env=="production" and .result=="success") | "\(.timestamp)  \(.commit)  \(.semver)"'

# Không có jq:
grep '"env":"production"' /var/log/autopost/deploys.jsonl | grep '"result":"success"' | tail -n 5
```

Lấy `commit` của bản tốt **liền trước** bản đang chạy lỗi → đó là `PREV_SHA`.

### 2.2 Từ tag GHCR (đối chiếu / khi không truy cập được audit log)

Xem các tag `sha-*` đã publish; mỗi tag là một artifact có thể quay về:

```bash
# Trên GitHub: Packages → autopost-api → versions, đọc các tag `sha-<commit>`.
# Hoặc kiểm tra nhanh một SHA cụ thể tồn tại trên registry:
docker manifest inspect ghcr.io/<owner>/autopost-api:sha-<PREV_SHA> >/dev/null \
  && echo "image tồn tại"
```

### 2.3 Xác nhận SHA đang chạy hiện tại (để không quay nhầm về chính nó)

```bash
curl -fsS https://api.${YOUR_DOMAIN}/version
# hoặc nội bộ, không phụ thuộc DNS/Caddy:
$COMPOSE exec -T api curl -fsS http://localhost:3001/version
# => {"commit":"<đang chạy>","buildId":"…"}  -> PREV_SHA phải KHÁC giá trị này.
```

---

## 3. Chạy rollback

`scripts/rollback.sh` nhận `PREV_SHA` làm tham số chính (khuyến nghị, luôn rõ ràng). Nếu bỏ trống,
script tự đọc bản `success` cuối cùng cho env mục tiêu từ audit log (và bỏ qua SHA đang chạy).

### 3.1 Cách khuyến nghị — truyền PREV_SHA tường minh

```bash
# Owner GHCR: đặt env GHCR_OWNER, hoặc để script tự suy ra từ `git remote origin`.
GHCR_OWNER="<owner>" \
API_HEALTH_URL="http://localhost:3001" \
  bash scripts/rollback.sh <PREV_SHA>
```

### 3.2 Cách fallback — để script tự tra audit log

```bash
GHCR_OWNER="<owner>" \
TARGET_ENV="production" \
DEPLOY_AUDIT_LOG="/var/log/autopost/deploys.jsonl" \
  bash scripts/rollback.sh
```

Script sẽ tuần tự:

1. **Resolve PREV_SHA** — `$1` trước, nếu trống thì lấy bản `success` mới nhất của `production`
   trong audit log (bỏ qua SHA đang chạy). Không có nguồn nào → dừng kèm lỗi rõ ràng, yêu cầu
   truyền `PREV_SHA`.
2. **Re-deploy** — sinh một Compose override pin `api`/`web`/`worker` về
   `ghcr.io/<owner>/autopost-{api,web,worker}:sha-<PREV_SHA>`, rồi:
   `docker compose -f docker-compose.prod.yml -f <override> pull api web worker`
   và `… up -d --no-build api web worker`. `--no-build` đảm bảo dùng đúng image đã publish
   (không build lại từ source). **Không** chạy `migrate` (Req 10.4).
3. **Verify** — poll `GET ${API_HEALTH_URL}/version` cho tới khi `.commit == PREV_SHA` **và**
   `GET ${API_HEALTH_URL}/health/ready` trả **200**, trong giới hạn `ROLLBACK_TIMEOUT_SECONDS`
   (mặc định 180s). Quá hạn → thoát non-zero để Operator can thiệp.

### 3.3 Các biến điều chỉnh (env)

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `$1` (PREV_SHA) | — | Full commit SHA cần quay về (nguồn chính) |
| `GHCR_OWNER` | suy từ git remote | Owner/org của image GHCR (tự lowercase) |
| `IMAGE_PREFIX` | `autopost` | Tiền tố tên image → `autopost-api`,… |
| `TARGET_ENV` | `production` | Env cần khớp khi đọc audit log |
| `DEPLOY_AUDIT_LOG` | `/var/log/autopost/deploys.jsonl` | Đường dẫn audit log JSONL |
| `COMPOSE_FILE` | `<repo>/docker-compose.prod.yml` | File compose prod |
| `API_HEALTH_URL` | `http://localhost:3001` | Base URL API để poll |
| `ROLLBACK_TIMEOUT_SECONDS` | `180` | Tổng thời gian chờ verify |
| `ROLLBACK_POLL_INTERVAL` | `5` | Khoảng giữa các lần poll |

---

## 4. Xác minh sau rollback (Verification)

Script đã tự verify, nhưng nên kiểm tra lại thủ công:

```bash
# 1) Đúng artifact đang chạy: /version.commit == PREV_SHA (Req 10.3)
curl -fsS https://api.${YOUR_DOMAIN}/version       # {"commit":"<PREV_SHA>", ...}

# 2) Readiness 200 — Postgres/Redis/Object_Storage đều với tới được
curl -fsS https://api.${YOUR_DOMAIN}/health/ready  # 200 {"status":"ready", ...}

# 3) Trạng thái container
$COMPOSE ps                                        # api/web/worker healthy/running
```

Kỳ vọng: `/version.commit` đúng bằng `PREV_SHA`, `/health/ready` trả **200**. Nếu muốn chạy lại
smoke test đầy đủ (login + tạo scheduled post):

```bash
SMOKE_API_URL="https://api.${YOUR_DOMAIN}" \
EXPECTED_SHA="<PREV_SHA>" \
SMOKE_EMAIL="${SMOKE_EMAIL}" SMOKE_PASSWORD="${SMOKE_PASSWORD}" \
  node scripts/smoke.ts
```

---

## 5. Khi nào nên rollback vs fix-forward

| Tình huống | Hành động |
| --- | --- |
| Prod smoke test fail ngay sau deploy; bản trước đó tốt | **Rollback** ngay về `PREV_SHA` |
| Lỗi nghiêm trọng/diện rộng (mất đăng nhập, 5xx hàng loạt) | **Rollback** trước, điều tra sau |
| Lỗi nhỏ, khoanh vùng được, có hotfix nhanh & an toàn | **Fix-forward** (deploy bản vá mới) |
| Bản mới đã chạy một thời gian, đã có ghi dữ liệu theo schema mới | Cân nhắc fix-forward; rollback image vẫn an toàn về schema (Req 10.4) nhưng hãy đánh giá dữ liệu/nghiệp vụ |
| Migration mới làm hỏng dữ liệu (không chỉ là code) | Rollback image **không đủ** → xem `docs/RESTORE.md` (khôi phục dữ liệu) |

> Nguyên tắc: ưu tiên khôi phục dịch vụ nhanh nhất. Rollback image rẻ và an toàn về schema nhờ
> chính sách migration backward-compatible; chỉ fix-forward khi bản vá rõ ràng, nhỏ và nhanh hơn.

---

## 6. Checklist rollback

- [ ] Đã xác định `PREV_SHA` (full commit SHA) từ Deploy_Audit_Record `success` của `production`.
- [ ] `PREV_SHA` **khác** với `/version.commit` đang chạy (không quay nhầm về bản lỗi).
- [ ] (Nếu cần) Đã `docker login ghcr.io` để kéo được image private.
- [ ] Đã chạy `bash scripts/rollback.sh <PREV_SHA>` với `GHCR_OWNER` đúng.
- [ ] Script báo pull + recreate `api`/`web`/`worker` thành công (`--no-build`, không `migrate`).
- [ ] `GET /version.commit` == `PREV_SHA`.
- [ ] `GET /health/ready` trả **200**.
- [ ] `$COMPOSE ps` cho thấy `api`/`web`/`worker` healthy; `postgres`/`redis`/`minio`/`caddy` không bị ảnh hưởng.
- [ ] (Tùy chọn) Smoke test đầy đủ với `EXPECTED_SHA=<PREV_SHA>` pass.
- [ ] Đã ghi lại sự cố + lý do rollback (liên hệ `docs/INCIDENT-PLAYBOOK.md`).

> Rollback tự động khi smoke fail (task 12.3) chạy đúng logic của `scripts/rollback.sh`; runbook này
> bảo đảm Operator có thể tự thực thi quy trình tương đương khi cần (Req 10.5).
