// Sinh app-config.json tại thời điểm build (build-time).
// Ghi đường dẫn tuyệt đối của thư mục gốc monorepo vào file để bản .exe đã đóng gói
// có thể tìm lại mã nguồn đã build (apps/api/dist, apps/web/.next, ...).
// Khi build, __dirname = apps/desktop, nên ../.. chính là gốc repo.
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..', '..');
const outPath = path.join(__dirname, 'app-config.json');

const config = {
  appRoot,
  builtAt: new Date().toISOString()
};

fs.writeFileSync(outPath, JSON.stringify(config, null, 2), 'utf8');
console.log(`[generate-config] Wrote ${outPath} -> appRoot=${appRoot}`);
