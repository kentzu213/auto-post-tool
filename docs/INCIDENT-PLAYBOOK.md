# Incident Response Playbook — Sổ tay xử lý sự cố Production

> Runbook chỉ-mục dành cho Operator. Tài liệu này **không** lặp lại nội dung các runbook chi
> tiết; nó là **bản đồ điều hướng**: phát hiện sự cố → quyết định hướng xử lý → trỏ tới đúng
> runbook → liên lạc → ghi nhận nguyên nhân gốc.
>
> Đáp ứng: **Req 15.6** — playbook xử lý sự cố bao trùm cả **Rollback** một bản deploy lỗi và
> **Restore_Procedure** cho `Postgres_Service` + `Object_Storage`.
>
> Hai runbook chi tiết mà tài liệu này gắn kết:
> - **Rollback bản deploy lỗi** → [`docs/ROLLBACK.md`](./ROLLBACK.md) + script [`scripts/rollback.sh`](../scripts/rollback.sh)
> - **Restore dữ liệu** (Postgres + Object_Storage) → [`docs/RESTORE.md`](./RESTORE.md) + script backup [`scripts/backup.sh`](../scripts/backup.sh)

---

## 0. Phạm vi & nguyên tắc

- **Mục tiêu**: đưa Production về trạng thái phục vụ an toàn nhanh nhất, với thao tác ít rủi
  ro nhất khả dĩ.
- **Thứ tự ưu tiên hành động**: ưu tiên hành động **hồi phục được** trước (rollback image)
  rồi mới đến hành động khó đảo ngược (restore dữ liệu).
- **Không phá hủy nếu chưa cần**: restore DB là thao tác có `DROP DATABASE` — chỉ dùng khi
  rollback không giải quyết được (xem cây quyết định ở mục 4).
- Mọi lệnh shell dùng `${VAR}` làm placeholder; **không** điền secret thật vào tài liệu hay
  vào log. File `.env` Production là root-owned, `chmod 600`, không nằm trong git
  (xem [`DEPLOYMENT.md`](../DEPLOYMENT.md)).

> Biến tiện dụng cho cả phiên:
> ```bash
> COMPOSE="docker compose -f docker-compose.prod.yml"
> ```

---

## 1. Tín hiệu phát hiện sự cố (Detection signals)

Một incident bắt đầu khi MỘT trong các tín hiệu dưới đây xuất hiện. Mỗi tín hiệu trỏ tới
hướng xử lý sơ bộ ở cột cuối (quyết định cuối cùng theo cây ở mục 4).

| # | Tín hiệu | Nguồn | Ý nghĩa | Hướng sơ bộ |
|---|---|---|---|---|
| S1 | **Alert: error-rate vượt ngưỡng** trong cửa sổ cấu hình | Quy tắc alert (task 9.4, Req 12.4) | API đang lỗi hàng loạt | Nghi bản deploy mới → cân nhắc **Rollback** |
| S2 | **Alert: job rơi vào Dead_Letter_Store** | Quy tắc alert (task 9.4, Req 12.5) | `Publish_Job`/`Sync_Job` cạn retry | Điều tra worker; thường **fix-forward** |
| S3 | **Smoke test FAIL** sau deploy | [`scripts/smoke.ts`](../scripts/smoke.ts) (Req 10.1) | Critical path hỏng / sai artifact | **Rollback** (tự động hoặc thủ công) |
| S4 | **`GET /health/ready` trả 503** | Health_Endpoint (Req 8.3) | Một `Data_Service` không với tới được (Postgres/Redis/Object_Storage) | Xem `checks` → phân loại hạ tầng vs dữ liệu |
| S5 | **`GET /health/live` không phản hồi** | Health_Endpoint (Req 8.1) | Tiến trình API chết/treo | Khởi động lại service; nếu do image mới → **Rollback** |

Tín hiệu phụ trợ khi phân loại:

```bash
# Artifact nào đang chạy? (so với SHA kỳ vọng — Property 2)
curl -fsS https://api.${YOUR_DOMAIN}/version

# Dependency nào đang "down"? (đọc trường checks)
curl -i  https://api.${YOUR_DOMAIN}/health/ready

# Kiểm tra nội bộ không phụ thuộc DNS/Caddy:
$COMPOSE exec -T api curl -fsS http://localhost:3001/health/ready
$COMPOSE ps                      # service nào unhealthy/restarting?
$COMPOSE logs --tail=200 api worker
```

---

## 2. Phân loại nhanh (Triage) — 60 giây đầu

1. **Ghi mốc thời gian** bắt đầu incident và tín hiệu kích hoạt (S1–S5).
2. **Có vừa deploy không?** Đối chiếu `Deploy_Audit_Record` (commit/semver/env/timestamp,
   Req 9.5/12.6) với thời điểm xuất hiện tín hiệu.
   - Tín hiệu xuất hiện **ngay sau** một Deployment_Run → khả năng cao là **bad deploy** → nhánh **Rollback**.
   - Không có deploy gần đây → nghiêng về hạ tầng/dữ liệu → nhánh **Restore** hoặc fix-forward.
3. **Phân biệt API lỗi vs dữ liệu mất**:
   - `/health/ready` = 503 với `checks.postgres = down` nhưng volume còn nguyên → sự cố **kết
     nối/hạ tầng** (thường KHÔNG cần restore).
   - Dữ liệu bị mất/hỏng/xóa nhầm, volume hỏng → nhánh **Restore** (mục 6).

---

## 3. Bảng tín hiệu → runbook (tra cứu nhanh)

| Tình huống | Runbook chính | Script |
|---|---|---|
| Bản deploy mới gây lỗi (S1/S3/S5 sau deploy) | [`docs/ROLLBACK.md`](./ROLLBACK.md) | [`scripts/rollback.sh`](../scripts/rollback.sh) |
| Mất / hỏng dữ liệu Postgres hoặc media | [`docs/RESTORE.md`](./RESTORE.md) | [`scripts/backup.sh`](../scripts/backup.sh) tạo bản backup để restore |
| Dependency down nhưng dữ liệu còn (S4) | Mục [7. Sự cố hạ tầng](#7-sự-cố-hạ-tầng-không-rollback-không-restore) | — |

---

## 4. Cây quyết định: Fix-forward vs Rollback vs Restore

```text
                ┌─────────────────────────────────────────────┐
                │  Có tín hiệu sự cố (S1–S5) + đã triage (mục 2) │
                └───────────────────────┬─────────────────────┘
                                        │
              ┌─────────────────────────┴──────────────────────────┐
              │ Sự cố bắt đầu NGAY SAU một Deployment_Run?          │
              └───────────────┬───────────────────────┬────────────┘
                          CÓ │                      KHÔNG │
                             ▼                            ▼
        ┌────────────────────────────┐      ┌──────────────────────────────┐
        │ Dữ liệu còn nguyên vẹn?     │      │ Dữ liệu bị mất/hỏng/xóa nhầm?  │
        │ (volume ok, chỉ code lỗi)   │      └───────┬───────────────┬───────┘
        └──────┬───────────────┬──────┘          CÓ │            KHÔNG │
            CÓ │           KHÔNG │                   ▼                  ▼
               ▼                 ▼            ┌──────────────┐   ┌───────────────┐
        ┌─────────────┐   ┌──────────────┐   │  RESTORE     │   │ Sự cố hạ tầng  │
        │  ROLLBACK    │   │  ROLLBACK +  │   │ (mục 6,      │   │ (mục 7): khởi  │
        │ (mục 5,      │   │  RESTORE     │   │ RESTORE.md)  │   │ động lại dep,  │
        │ ROLLBACK.md) │   │ (mục 5→6)    │   └──────────────┘   │ KHÔNG restore  │
        └─────────────┘   └──────────────┘                      └───────────────┘

  FIX-FORWARD (vá tiến) — chọn khi:
   • Lỗi nhỏ, đã biết rõ nguyên nhân, có hotfix an toàn deploy nhanh hơn rollback; HOẶC
   • Schema migration MỚI khiến rollback không an toàn (đáng lẽ không xảy ra vì migration
     theo chính sách forward-only/backward-compatible — Req 7.2/10.4); HOẶC
   • Sự cố nằm ở job/worker (S2) chứ không phải toàn API.
```

Quy tắc rút gọn:
- **Bad deploy + dữ liệu nguyên** → **Rollback** (nhanh, đảo ngược được). Đây là mặc định.
- **Dữ liệu mất/hỏng** → **Restore** (chậm hơn, có thao tác phá hủy — cân nhắc kỹ).
- **Lỗi nhỏ đã hiểu rõ, hotfix nhanh & an toàn** → **Fix-forward**.
- **Dependency down, dữ liệu còn** → **không** rollback/restore; xử lý hạ tầng (mục 7).

---

## 5. Nhánh ROLLBACK — quay về image tốt trước đó

> Chi tiết đầy đủ: [`docs/ROLLBACK.md`](./ROLLBACK.md). Phần này chỉ là con trỏ + đường lùi thủ công.

### 5.1 Bằng script (đường mặc định)

```bash
# Quay Production về SHA tốt gần nhất theo Deploy_Audit_Record, chờ tới khi
# /version.commit == prevSHA và /health/ready == 200 (Req 10.2/10.3).
# Khuyến nghị truyền PREV_SHA tường minh; GHCR_OWNER là owner/org của image GHCR.
GHCR_OWNER="<owner>" bash scripts/rollback.sh <PREV_SHA>

# Hoặc để script tự đọc bản success cuối cùng của production từ audit log:
GHCR_OWNER="<owner>" bash scripts/rollback.sh
```

Rollback an toàn về schema vì migration theo chính sách **forward-only / backward-compatible**
(Req 7.2, 7.6, 10.4): quay về image cũ **không** đòi thao tác schema phá hủy. Script chỉ tái tạo
`api`/`web`/`worker` (`--no-build`, không chạy `migrate`); `postgres`/`redis`/`minio`/`caddy`
không bị đụng tới. Chi tiết tham số (`GHCR_OWNER`, `API_HEALTH_URL`, `ROLLBACK_TIMEOUT_SECONDS`…)
xem [`docs/ROLLBACK.md`](./ROLLBACK.md).

### 5.2 Rollback thủ công (khi không chạy được script)

Nếu không dùng được `scripts/rollback.sh`, Operator quay tay theo đúng cách script làm — pin 3
service về image GHCR tag `:sha-<PREV_SHA>` (chính là `/version.commit`), đúng tinh thần Req 10.5:

```bash
# 1. Lấy PREV_SHA = full commit SHA của lần deploy production thành công liền trước
#    (từ Deploy_Audit_Record; xem docs/ROLLBACK.md mục 2). Phải KHÁC /version.commit đang chạy.
PREV_SHA="<commit-sha-thành-công-trước-đó>"
REG="ghcr.io/<owner>"

# 2. Tạo compose override trỏ api/web/worker về image :sha-<PREV_SHA> (không rebuild).
cat > docker-compose.rollback.yml <<EOF
services:
  api:    { image: ${REG}/autopost-api:sha-${PREV_SHA} }
  web:    { image: ${REG}/autopost-web:sha-${PREV_SHA} }
  worker: { image: ${REG}/autopost-worker:sha-${PREV_SHA} }
EOF

RB="docker compose -f docker-compose.prod.yml -f docker-compose.rollback.yml"
$RB pull api web worker
$RB up -d --no-build api web worker      # KHÔNG chạy migrate (Req 10.4)

# 3. Xác minh đúng artifact đã chạy và sẵn sàng phục vụ.
curl -fsS https://api.${YOUR_DOMAIN}/version       # commit phải == $PREV_SHA
curl -fsS https://api.${YOUR_DOMAIN}/health/ready   # phải == 200
```

> Sau rollback, chạy lại smoke test để xác nhận critical path đã xanh:
> ```bash
> SMOKE_API_URL=https://api.${YOUR_DOMAIN} EXPECTED_SHA="$PREV_SHA" node scripts/smoke.ts
> ```

Nếu rollback **không** khôi phục dịch vụ → dữ liệu có thể đã hỏng → chuyển sang nhánh
**RESTORE** (mục 6).

---

## 6. Nhánh RESTORE — khôi phục Postgres + Object_Storage

> Chi tiết đầy đủ (từng lệnh, checklist, cảnh báo an toàn): [`docs/RESTORE.md`](./RESTORE.md).
> Đáp ứng Req 13.4 (Postgres), Req 13.5 (media), Req 13.7 (tài liệu cho cả hai).

Tóm tắt thứ tự thao tác (chi tiết ở `RESTORE.md`):

```text
stop api + worker → restore DB (gunzip | psql) → restore media (mc mirror / aws s3 sync)
→ migrate deploy → /health/ready == 200 → resume services
```

Con trỏ nhanh:
- Bản backup do [`scripts/backup.sh`](../scripts/backup.sh) tạo, nằm dưới `${BACKUP_DIR}` (mặc
  định `/backups`): dump Postgres tại `pg/autopost-<timestamp>.sql.gz`, media mirror tại `media/`.
- **Trước khi `DROP DATABASE`** (thao tác không thể hoàn tác), tạo bản `pg_dump` an toàn của
  trạng thái hiện tại làm đường lùi — xem mục 7 của [`docs/RESTORE.md`](./RESTORE.md).
- Kết thúc bằng kiểm tra `GET /health/ready` = 200 và spot-check số bản ghi.

---

## 7. Sự cố hạ tầng (không rollback, không restore)

Khi `/health/ready` = 503 nhưng **dữ liệu còn nguyên** (chỉ là dependency tạm thời mất kết nối):

```bash
# Xác định dependency nào down:
curl -i https://api.${YOUR_DOMAIN}/health/ready    # đọc trường checks: postgres/redis/storage

# Khởi động lại đúng dependency rồi chờ healthy (KHÔNG đụng tới dữ liệu):
$COMPOSE restart postgres        # hoặc redis / minio tùy checks
$COMPOSE ps
$COMPOSE logs --tail=100 postgres redis minio
```

- Redis có AOF persistence (Req 3.6/3.7) → job đã xếp hàng vẫn còn sau restart.
- Chỉ chuyển sang **RESTORE** nếu xác nhận dữ liệu thực sự mất/hỏng, không phải mất kết nối.

---

## 8. Liên lạc trong sự cố (Communication steps)

1. **Khai báo incident**: thông báo kênh trực (Slack/Telegram) — nêu **mức độ**, **tín hiệu**
   (S1–S5), **thời điểm bắt đầu**, **người chỉ huy xử lý (Incident Commander)**.
2. **Trong khi xử lý**: cập nhật trạng thái định kỳ (ví dụ mỗi 15–30 phút) — đang ở nhánh nào
   (Rollback/Restore/Fix-forward), ETA dự kiến.
3. **Người dùng bị ảnh hưởng**: nếu downtime đáng kể, đăng thông báo status ngắn gọn, không
   tiết lộ chi tiết kỹ thuật nhạy cảm hay secret.
4. **Tuyên bố khắc phục (resolved)**: khi `/health/ready` = 200, smoke test xanh, alert hết
   kêu — thông báo đóng incident và mốc thời gian.
5. **Nguyên tắc nội dung**: tuyệt đối **không** dán secret, token giải mã, hay chuỗi kết nối
   vào kênh chat/log (Req 6.3/12.7).

> Webhook alert dùng chung với backup (`BACKUP_ALERT_WEBHOOK_URL`, body `{"text": ...}`) có
> thể tái dùng cho thông báo incident — xem [`scripts/backup.sh`](../scripts/backup.sh).

---

## 9. Ghi nhận nguyên nhân gốc sau sự cố (Post-incident root-cause note)

Sau khi đóng incident, ghi lại một **post-mortem ngắn** (blameless) và lưu cùng nơi với
`Deploy_Audit_Record` để truy vết được:

```markdown
## Post-incident — <ngày> — <tiêu đề ngắn>
- Severity:            <SEV1/SEV2/SEV3>
- Phát hiện lúc:       <timestamp> qua tín hiệu <S1–S5>
- Khắc phục lúc:       <timestamp>  (downtime ≈ <phút>)
- Commit/artifact liên quan: <SHA bị lỗi> → <SHA đã rollback/hotfix>  (từ Deploy_Audit_Record)
- Hành động đã làm:    <Rollback | Restore | Fix-forward> — tóm tắt các bước
- Nguyên nhân gốc:     <root cause — KHÔNG đổ lỗi cá nhân>
- Vì sao lọt qua:      <smoke/scan/test/migration policy đã bỏ sót gì>
- Hành động phòng ngừa: <việc cần làm + người phụ trách + hạn>
```

Tối thiểu một post-mortem cần trả lời: **điều gì đã xảy ra**, **vì sao**, **đã sửa thế nào**,
và **làm gì để không tái diễn** (ví dụ: bổ sung assertion vào `scripts/smoke.ts`, siết ngưỡng
alert ở task 9.4, hoặc bổ sung Migration_Step kiểm tra tương thích ngược).

---

## 10. Checklist xử lý sự cố (in nhanh)

- [ ] Đã ghi mốc thời gian bắt đầu + tín hiệu kích hoạt (S1–S5).
- [ ] Đã kiểm tra `/version`, `/health/ready`, `$COMPOSE ps`, logs.
- [ ] Đã đối chiếu `Deploy_Audit_Record` xem có deploy gần đây không.
- [ ] Đã chọn nhánh theo cây quyết định (mục 4): Fix-forward / Rollback / Restore.
- [ ] (Rollback) Đã chạy `scripts/rollback.sh` **hoặc** quy trình thủ công 5.2; `/version` về SHA cũ; `/health/ready` = 200.
- [ ] (Restore) Đã theo [`docs/RESTORE.md`](./RESTORE.md); có bản `pg_dump` lùi trước khi `DROP`; `/health/ready` = 200; spot-check khớp.
- [ ] Đã chạy lại `scripts/smoke.ts` — critical path xanh.
- [ ] Đã liên lạc: khai báo → cập nhật → tuyên bố resolved (không lộ secret).
- [ ] Đã viết post-incident root-cause note và lưu để truy vết.
