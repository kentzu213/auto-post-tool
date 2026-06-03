# Restore_Procedure — Khôi phục từ Backup (Postgres + Object_Storage)

> Runbook dành cho Operator. Quy trình khôi phục `Postgres_Service` và `Object_Storage`
> từ các bản backup do `scripts/backup.sh` tạo ra.
>
> Đáp ứng: **Req 13.4** (restore Postgres), **Req 13.5** (restore media trong Object_Storage),
> **Req 13.7** (tài liệu Restore_Procedure cho cả hai).
>
> Quy trình này được kiểm chứng định kỳ bằng **restore drill** (task 10.5 trong spec
> `saas-production-deployment`), chạy đúng các bước dưới đây trên một Postgres rỗng + một
> bucket sạch rồi xác minh `/health/ready` trả 200 và spot-check dữ liệu đã khôi phục.

---

## 0. Backup nhìn như thế nào (bố cục do `scripts/backup.sh` tạo ra)

`scripts/backup.sh` ghi mọi thứ dưới `${BACKUP_DIR}` (mặc định `/backups`):

```text
${BACKUP_DIR}/
├── pg/
│   ├── autopost-2026-05-25-0300.sql.gz      # pg_dump | gzip  (Req 13.1)
│   ├── autopost-2026-05-26-0300.sql.gz
│   └── ...
├── media/                                    # mirror của bucket Object_Storage (Req 13.2)
│   └── <các object media được sao y theo key>
└── backup.log
```

- File Postgres là **gzip của một logical `pg_dump`** → tên `autopost-<YYYY-MM-DD-HHMM>.sql.gz`.
  Vì vậy lệnh restore **bắt buộc** phải `gunzip` trước khi đẩy vào `psql` (xem phần 3).
- Thư mục `media/` là bản mirror trực tiếp các object trong bucket (giữ nguyên key), tạo bởi
  `mc mirror` (MinIO) hoặc `aws s3 sync` (R2/S3).

> **Chọn bản backup nào:** liệt kê và chọn timestamp mong muốn trước khi bắt đầu.
> ```bash
> ls -lh "${BACKUP_DIR}/pg/"
> # ví dụ chọn: BACKUP_FILE="${BACKUP_DIR}/pg/autopost-2026-05-26-0300.sql.gz"
> ```

---

## 1. Yêu cầu trước khi bắt đầu (Prerequisites)

- Quyền SSH vào VPS Production và quyền chạy `docker compose`.
- File `docker-compose.prod.yml` và file `.env` Production có mặt tại thư mục dự án trên VPS
  (file `.env` là root-owned, `chmod 600`, **không** nằm trong git — xem `DEPLOYMENT.md`).
- Truy cập được tới `${BACKUP_DIR}` chứa bản backup cần khôi phục (mount cùng host hoặc copy về).
- Các biến môi trường/secret dưới dạng **placeholder `${VAR}`** (không bao giờ điền giá trị thật
  vào tài liệu này):
  - Postgres: `${POSTGRES_USER}`, `${POSTGRES_PASSWORD}`, `${POSTGRES_DB}`, `${DATABASE_URL}`
  - Object_Storage: `${S3_ENDPOINT}`, `${S3_ACCESS_KEY}`, `${S3_SECRET_KEY}`, `${S3_BUCKET_NAME}`
- Công cụ cho media restore: `mc` (MinIO client) **hoặc** `aws` CLI.
- Tên service trong `docker-compose.prod.yml` (dùng xuyên suốt runbook): `postgres`, `minio`,
  `migrate`, `api`, `worker`, `web`.

> Đặt sẵn một biến tiện dụng cho cả phiên làm việc:
> ```bash
> COMPOSE="docker compose -f docker-compose.prod.yml"
> ```

---

## 2. Thứ tự thao tác (Order of operations)

```text
stop services (api + worker)  →  restore DB  →  restore media  →  migrate deploy  →  health check  →  resume services
```

Dừng `api` + `worker` TRƯỚC để không có tiến trình nào ghi vào DB/bucket giữa lúc restore
(tránh dữ liệu lẫn lộn / ghi đè). Chỉ bật lại sau khi `/health/ready` trả 200.

---

## 3. Khôi phục PostgreSQL (Req 13.4)

### 3.1 Dừng các service ghi dữ liệu

```bash
$COMPOSE stop api worker
# postgres VẪN chạy để nhận dữ liệu restore; chỉ api + worker bị dừng.
```

### 3.2 Đảm bảo Postgres ở trạng thái RỖNG

Req 13.4 mô tả restore vào một `Postgres_Service` rỗng. Nếu đây là instance mới hoàn toàn
(volume trống) thì đã sẵn sàng. Nếu cần dựng lại một DB rỗng trên stack hiện tại:

```bash
# Tạo lại schema rỗng (THAO TÁC PHÁ HỦY — xoá toàn bộ dữ liệu hiện có trong DB ${POSTGRES_DB}).
# Chỉ chạy khi bạn chắc chắn đang chủ đích ghi đè bằng bản backup.
$COMPOSE exec -T postgres psql -U "${POSTGRES_USER}" -d postgres \
  -c "DROP DATABASE IF EXISTS \"${POSTGRES_DB}\";" \
  -c "CREATE DATABASE \"${POSTGRES_DB}\" OWNER \"${POSTGRES_USER}\";"
```

> ⚠️ `DROP DATABASE` là thao tác **không thể hoàn tác**. Hãy chắc chắn bạn đang ghi đè đúng DB
> và đã chọn đúng `BACKUP_FILE`. Bỏ qua bước này nếu DB vốn đã rỗng.

### 3.3 Nạp bản dump (gunzip → psql)

Vì bản dump là `.sql.gz`, luôn `gunzip -c` rồi pipe vào `psql`.

**Biến thể prod stack (chạy psql bên trong container `postgres`)** — khuyến nghị, vì
`postgres` không publish port ra host:

```bash
BACKUP_FILE="${BACKUP_DIR}/pg/autopost-2026-05-26-0300.sql.gz"   # ví dụ; chọn bản của bạn

gunzip -c "$BACKUP_FILE" | \
  $COMPOSE exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"
```

**Biến thể dùng `${DATABASE_URL}` trực tiếp** (khi chạy từ một host có `psql` và route được
tới DB, ví dụ trong quá trình drill/migration với connection string đầy đủ):

```bash
gunzip -c "$BACKUP_FILE" | psql "${DATABASE_URL}"
```

> Cờ `-T` của `docker compose exec` là bắt buộc khi pipe dữ liệu qua stdin (tắt cấp phát TTY).

### 3.4 Chạy migration nếu cần (`prisma migrate deploy`)

Nếu bản backup cũ hơn schema mà code hiện tại yêu cầu, áp các migration còn thiếu bằng đúng
service one-shot `migrate` (cùng image với `api`, idempotent):

```bash
$COMPOSE run --rm migrate
# tương đương: prisma migrate deploy --schema=apps/api/prisma/schema.prisma
```

`prisma migrate deploy` chỉ áp các bước **chưa** được áp; nếu schema đã khớp thì không thay đổi gì.

---

## 4. Khôi phục media trong Object_Storage (Req 13.5)

Đẩy lại các object từ `${BACKUP_DIR}/media/` vào bucket. Dùng đúng công cụ có trên host.

### 4.1 MinIO (mặc định self-hosted) — `mc mirror`

```bash
# Đăng ký alias trỏ tới endpoint Object_Storage (credential lấy từ env, KHÔNG hardcode).
mc alias set autopostrestore "${S3_ENDPOINT}" "${S3_ACCESS_KEY}" "${S3_SECRET_KEY}"

# Tạo bucket nếu chưa tồn tại (bỏ qua nếu đã có).
mc mb --ignore-existing "autopostrestore/${S3_BUCKET_NAME}"

# Mirror NGƯỢC chiều backup: từ thư mục backup -> vào bucket.
mc mirror --overwrite "${BACKUP_DIR}/media/" "autopostrestore/${S3_BUCKET_NAME}"
```

> Lưu ý chiều mirror: backup làm `mc mirror <alias>/<bucket> -> ${BACKUP_DIR}/media/`; restore
> đảo lại `${BACKUP_DIR}/media/ -> <alias>/<bucket>`.

### 4.2 Cloudflare R2 / AWS S3 — `aws s3 sync`

```bash
AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY}" \
AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY}" \
AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}" \
  aws s3 sync "${BACKUP_DIR}/media/" "s3://${S3_BUCKET_NAME}" --endpoint-url "${S3_ENDPOINT}"
```

### 4.3 Xác minh một object lấy về được

```bash
# MinIO: liệt kê và stat một object bất kỳ
mc ls "autopostrestore/${S3_BUCKET_NAME}"
mc stat "autopostrestore/${S3_BUCKET_NAME}/<một-object-key>"

# S3/R2:
aws s3 ls "s3://${S3_BUCKET_NAME}/" --endpoint-url "${S3_ENDPOINT}"
```

---

## 5. Health check (Req 13.4 — xác minh DB đã sẵn sàng)

Bật lại `api` (và `worker`) rồi kiểm tra readiness. `/health/ready` chỉ trả 200 khi Postgres,
Redis và Object_Storage đều với tới được.

```bash
$COMPOSE up -d api worker

# Qua Caddy ở api hostname (thay bằng domain của bạn):
curl -fsS https://api.${YOUR_DOMAIN}/health/ready

# Hoặc kiểm tra nội bộ ngay trong container api (không phụ thuộc DNS/Caddy):
$COMPOSE exec -T api curl -fsS http://localhost:3001/health/ready
```

Kỳ vọng: HTTP **200** với body `{"status":"ready", ...}`. Nếu 503, đọc trường `checks` để biết
dependency nào đang `down` rồi xử lý trước khi tiếp tục.

### Spot-check dữ liệu đã khôi phục

```bash
# Liệt kê các bảng + đếm vài bản ghi (tên bảng theo schema Prisma: User, Workspace, Post, ...).
$COMPOSE exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -c "\dt"
$COMPOSE exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  -c 'SELECT count(*) FROM "User";' \
  -c 'SELECT count(*) FROM "Workspace";'
```

Số bản ghi phải khớp với những gì bản backup nắm giữ.

---

## 6. Resume services

Sau khi `/health/ready` = 200 và spot-check đạt, đưa toàn bộ stack về trạng thái phục vụ:

```bash
$COMPOSE up -d            # bật lại web/api/worker/caddy nếu còn service nào đang dừng
$COMPOSE ps               # xác nhận tất cả service ở trạng thái healthy/running
```

---

## 7. Ghi chú an toàn & rollback (Rollback-safety)

- **Dừng `api` + `worker` trước khi restore** để không có ghi đè giữa chừng (đã nêu ở phần 2/3.1).
- **`DROP DATABASE` ở 3.2 là không thể hoàn tác.** Trước khi ghi đè một DB đang có dữ liệu, hãy
  tạo một `pg_dump` an toàn của trạng thái hiện tại để có đường lùi:
  ```bash
  $COMPOSE exec -T postgres pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
    | gzip -c > "${BACKUP_DIR}/pg/pre-restore-$(date +%F-%H%M).sql.gz"
  ```
- Restore vào **Postgres rỗng** là an toàn nhất; tránh đổ một dump lên một DB đã có dữ liệu một
  phần (dễ xung đột khoá/ràng buộc).
- Media mirror dùng `--overwrite` (MinIO) / `sync` (S3) nên **không xoá** object phía bucket đang
  thừa; nếu cần bản sạch tuyệt đối, hãy tạo bucket mới rồi mirror vào.
- Backup được lưu **tách khỏi volume dữ liệu chính** (xem `scripts/backup.sh`), nên sự cố mất đĩa
  dữ liệu không kéo theo mất backup.
- Schema theo chính sách forward-only/backward-compatible (xem design): rollback image về SHA cũ
  không cần thao tác schema phá hủy.

---

## 8. Checklist xác minh cuối cùng

- [ ] Đã chọn đúng `BACKUP_FILE` trong `${BACKUP_DIR}/pg/autopost-<timestamp>.sql.gz`.
- [ ] Đã dừng `api` và `worker` trước khi restore.
- [ ] (Nếu ghi đè) Đã `pg_dump` trạng thái hiện tại làm bản lùi an toàn.
- [ ] Postgres ở trạng thái rỗng/đúng chủ đích trước khi nạp dump.
- [ ] Đã nạp dump bằng `gunzip -c "$BACKUP_FILE" | psql ...` không lỗi.
- [ ] Đã chạy `migrate` (`prisma migrate deploy`) nếu cần và thành công.
- [ ] Đã restore media: `mc mirror ${BACKUP_DIR}/media/ <alias>/${S3_BUCKET_NAME}` (hoặc `aws s3 sync`).
- [ ] Đã xác minh lấy được ít nhất một object media (`mc stat` / `aws s3 ls`).
- [ ] `GET /health/ready` trả **200** (`status: ready`).
- [ ] Spot-check số bản ghi (`User`, `Workspace`, ...) khớp bản backup.
- [ ] Đã bật lại toàn bộ service (`$COMPOSE up -d`) và `ps` báo healthy.

> Restore drill (task 10.5) thực thi đúng checklist này định kỳ để bảo đảm Restore_Procedure
> luôn hoạt động khi cần thật.
