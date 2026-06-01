const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const net = require('net');

let launcherWindow;
let mainWindow;
const activeProcesses = [];
let checkInterval;
let workerStarted = false;

// Trạng thái các cổng dịch vụ mặc định
const SERVICES = {
  postgres: { name: 'PostgreSQL', port: 5432, type: 'database' },
  redis: { name: 'Redis', port: 6379, type: 'database' },
  minio: { name: 'MinIO Storage', port: 9000, type: 'database' },
  api: { name: 'NestJS API', port: 3001, type: 'node' },
  web: { name: 'Next.js Web', port: 3005, type: 'node' }
};

const serviceStates = {
  postgres: 'checking',
  redis: 'checking',
  minio: 'checking',
  api: 'checking',
  web: 'checking'
};

// Thông điệp lỗi chi tiết theo từng dịch vụ (hiển thị trên Launcher khi state = 'error')
const serviceErrors = {};

// Hàm kiểm tra trạng thái cổng (Pure Node.js)
function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true); // Cổng đang bị chiếm (dịch vụ đang chạy)
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(false); // Cổng trống (dịch vụ chưa chạy)
    });
    server.listen(port);
  });
}

// Gửi cập nhật trạng thái xuống Giao diện Launcher
function broadcastStatus() {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.webContents.send('service-status-update', serviceStates);
    launcherWindow.webContents.send('service-error-update', serviceErrors);
  }
}

// Đặt trạng thái lỗi kèm thông điệp rõ ràng cho một dịch vụ
function setServiceError(serviceName, message) {
  serviceStates[serviceName] = 'error';
  serviceErrors[serviceName] = message;
  console.error(`[${serviceName} Error]: ${message}`);
  broadcastStatus();
}

// Quét kiểm tra tất cả các dịch vụ
async function performServicesCheck() {
  console.log('🔍 Checking services...');
  
  // 1. Kiểm tra cơ sở dữ liệu trước
  const pgActive = await checkPort(SERVICES.postgres.port);
  const redisActive = await checkPort(SERVICES.redis.port);
  const minioActive = await checkPort(SERVICES.minio.port);

  serviceStates.postgres = pgActive ? 'running' : 'offline';
  serviceStates.redis = redisActive ? 'running' : 'offline';
  serviceStates.minio = minioActive ? 'running' : 'offline';

  // Nếu cơ sở dữ liệu chưa sẵn sàng thì dừng lại
  if (!pgActive || !redisActive || !minioActive) {
    serviceStates.api = 'checking';
    serviceStates.web = 'checking';
    broadcastStatus();
    return;
  }

  // 2. Kiểm tra các dịch vụ Node.js
  const apiActive = await checkPort(SERVICES.api.port);
  const webActive = await checkPort(SERVICES.web.port);

  // Cập nhật trạng thái API
  if (apiActive) {
    serviceStates.api = 'active';
  } else if (serviceStates.api !== 'starting') {
    // Nếu chưa khởi động và cổng trống -> Tiến hành khởi động
    startNodeService('api');
  }

  // Cập nhật trạng thái Web
  if (webActive) {
    serviceStates.web = 'active';
  } else if (serviceStates.web !== 'starting') {
    // Nếu chưa khởi động và cổng trống -> Tiến hành khởi động
    startNodeService('web');
  }

  // Khởi chạy Worker nếu chưa chạy
  if (!workerStarted && (serviceStates.api === 'starting' || serviceStates.api === 'active')) {
    workerStarted = true;
    startNodeService('worker');
  }

  broadcastStatus();

  // 3. Nếu toàn bộ dịch vụ đã active -> Chuyển hướng vào app chính!
  if (serviceStates.api === 'active' && serviceStates.web === 'active') {
    clearInterval(checkInterval);
    setTimeout(launchMainWindow, 800);
  }
}

// Đọc đường dẫn gốc monorepo được nhúng tại thời điểm build (app-config.json).
// File này do generate-config.js sinh ra trước khi electron-builder đóng gói,
// nên bản .exe đã cài vẫn biết repo nằm ở đâu trên máy dev.
function readEmbeddedAppRoot() {
  try {
    const cfgPath = path.join(__dirname, 'app-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg && cfg.appRoot) return cfg.appRoot;
    }
  } catch (e) {
    console.error('[config] Không đọc được app-config.json:', e.message);
  }
  return null;
}

// Tìm thư mục gốc monorepo (chứa apps/api/dist) một cách đáng tin cậy.
// Thứ tự ưu tiên các ứng viên:
//   1) biến môi trường IZZI_APP_ROOT (người dùng tự cấu hình nếu repo ở vị trí khác)
//   2) appRoot nhúng tại build-time (app-config.json) -> giúp .exe đã cài tìm lại repo
//   3) __dirname/../.. (trường hợp chạy dev / unpackaged)
// Trả về null nếu không tìm thấy -> để báo lỗi rõ ràng thay vì spawn nhầm.
function resolveWorkspaceRoot() {
  const candidates = [];
  if (process.env.IZZI_APP_ROOT) {
    candidates.push(process.env.IZZI_APP_ROOT);
  }
  const embedded = readEmbeddedAppRoot();
  if (embedded) {
    candidates.push(embedded);
  }
  candidates.push(path.join(__dirname, '../..'));

  for (const root of candidates) {
    if (root && fs.existsSync(path.join(root, 'apps/api/dist/src/main.js'))) {
      return root;
    }
  }
  return null;
}

// Kiểm tra các artifact build cần thiết cho chế độ production của từng dịch vụ.
// Trả về null nếu hợp lệ, hoặc một thông điệp lỗi rõ ràng (tiếng Việt) nếu thiếu.
function checkProductionBuild(serviceName, workspaceRoot) {
  if (serviceName === 'api') {
    if (!fs.existsSync(path.join(workspaceRoot, 'apps/api/dist/src/main.js'))) {
      return 'Thiếu bản build API (apps/api/dist/src/main.js). Hãy chạy: pnpm --filter @auto-post/api build';
    }
  } else if (serviceName === 'web') {
    // next start YÊU CẦU bản build production (.next/BUILD_ID), không phải next dev
    if (!fs.existsSync(path.join(workspaceRoot, 'apps/web/.next/BUILD_ID'))) {
      return 'Thiếu bản build production của Web (apps/web/.next/BUILD_ID). Hãy chạy: pnpm --filter @auto-post/web build';
    }
  } else if (serviceName === 'worker') {
    if (!fs.existsSync(path.join(workspaceRoot, 'apps/worker/dist/index.js'))) {
      return 'Thiếu bản build Worker (apps/worker/dist/index.js). Hãy chạy: pnpm --filter @auto-post/worker build';
    }
  }
  return null;
}

// Khởi chạy các tiến trình Node.js ngầm
function startNodeService(serviceName) {
  serviceStates[serviceName] = 'starting';
  broadcastStatus();

  const isPackaged = app.isPackaged;
  const workspaceRoot = resolveWorkspaceRoot();

  let child;

  if (!isPackaged) {
    // Chế độ phát triển (Development): Chạy lệnh qua pnpm workspace
    const devRoot = workspaceRoot || path.join(__dirname, '../..');
    const filter = serviceName === 'api' ? '@auto-post/api' : (serviceName === 'web' ? '@auto-post/web' : '@auto-post/worker');
    console.log(`🚀 Starting ${serviceName} in dev mode via pnpm...`);

    child = spawn('pnpm', ['--filter', filter, 'dev'], {
      shell: true,
      cwd: devRoot
    });
  } else {
    // Chế độ sản phẩm (Production): Chạy trực tiếp các file build dist/.next
    console.log(`🚀 Starting ${serviceName} in production mode...`);
    if (!workspaceRoot) {
      // Không tìm thấy mã nguồn đã build -> báo lỗi rõ ràng thay vì spawn nhầm đường dẫn
      setServiceError(
        serviceName,
        'Không tìm thấy thư mục dự án (apps/api/dist). Hãy đặt biến môi trường IZZI_APP_ROOT trỏ tới thư mục monorepo trên máy, rồi mở lại ứng dụng.'
      );
      return;
    }
    // Kiểm tra artifact build production của riêng dịch vụ này
    const buildError = checkProductionBuild(serviceName, workspaceRoot);
    if (buildError) {
      setServiceError(serviceName, buildError);
      return;
    }
    if (serviceName === 'api') {
      child = spawn('node', [path.join(workspaceRoot, 'apps/api/dist/src/main.js')], {
        shell: true,
        cwd: path.join(workspaceRoot, 'apps/api')
      });
    } else if (serviceName === 'web') {
      // next start cần chạy với cwd = apps/web để tìm thư mục .next; next bin nằm trong node_modules của web
      child = spawn('node', [path.join(workspaceRoot, 'apps/web/node_modules/next/dist/bin/next'), 'start', '-p', '3005'], {
        shell: true,
        cwd: path.join(workspaceRoot, 'apps/web')
      });
    } else if (serviceName === 'worker') {
      child = spawn('node', [path.join(workspaceRoot, 'apps/worker/dist/index.js')], {
        shell: true,
        cwd: path.join(workspaceRoot, 'apps/worker')
      });
    }
  }

  child.stdout.on('data', (data) => {
    console.log(`[${serviceName}]: ${data.toString().trim()}`);
  });

  child.stderr.on('data', (data) => {
    console.error(`[${serviceName} Error]: ${data.toString().trim()}`);
  });

  child.on('close', (code) => {
    console.log(`[${serviceName}] exited with code ${code}`);
    if (serviceStates[serviceName] !== 'active') {
      setServiceError(
        serviceName,
        `Tiến trình ${serviceName} thoát với mã ${code}. Kiểm tra log/cổng (API:3001, Web:3005) hoặc file .env tương ứng.`
      );
    }
  });

  activeProcesses.push(child);
}

// Tạo cửa sổ Splash Screen
function createLauncherWindow() {
  launcherWindow = new BrowserWindow({
    width: 600,
    height: 480,
    frame: false,
    resizable: false,
    backgroundColor: '#05070f',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  launcherWindow.loadFile(path.join(__dirname, 'launcher.html'));

  launcherWindow.once('ready-to-show', () => {
    launcherWindow.show();
    // Bắt đầu vòng lặp kiểm tra
    performServicesCheck();
    checkInterval = setInterval(performServicesCheck, 2000);
  });
}

// Tạo cửa sổ Dashboard Chính (khi các server đã sẵn sàng)
function launchMainWindow() {
  if (mainWindow) return;

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 768,
    title: 'Izzi Auto Post',
    backgroundColor: '#05070f',
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#05070f',
      symbolColor: '#94a3b8',
      height: 40
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL('http://localhost:3005');

  mainWindow.once('ready-to-show', () => {
    // Ẩn launcher và hiện cửa sổ chính với hiệu ứng mượt mà
    mainWindow.show();
    if (launcherWindow) {
      launcherWindow.close();
      launcherWindow = null;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit();
  });
}

// Giải phóng toàn bộ tiến trình con (Tránh lỗi chiếm dụng cổng zombie)
function cleanupProcesses() {
  console.log('🧹 Cleaning up background processes...');
  clearInterval(checkInterval);
  
  activeProcesses.forEach((child) => {
    if (child && child.pid) {
      console.log(`Killing process tree for PID: ${child.pid}`);
      if (process.platform === 'win32') {
        exec(`taskkill /pid ${child.pid} /T /F`, (err) => {
          if (err) console.error(`Failed to kill process tree for ${child.pid}:`, err);
        });
      } else {
        process.kill(-child.pid, 'SIGKILL'); // Unix process group kill
      }
    }
  });
}

// Đăng ký các cổng giao tiếp IPC
ipcMain.on('retry-services-check', () => {
  console.log('🔄 User triggered manual retry check...');
  performServicesCheck();
});

// Vòng đời ứng dụng Electron
app.on('ready', createLauncherWindow);

app.on('will-quit', () => {
  cleanupProcesses();
});

app.on('window-all-closed', () => {
  cleanupProcesses();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (launcherWindow === null && mainWindow === null) {
    createLauncherWindow();
  }
});
