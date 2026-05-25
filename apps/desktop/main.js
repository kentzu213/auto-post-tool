const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
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
  }
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

// Khởi chạy các tiến trình Node.js ngầm
function startNodeService(serviceName) {
  serviceStates[serviceName] = 'starting';
  broadcastStatus();

  const isPackaged = app.isPackaged;
  const workspaceRoot = path.join(__dirname, '../..');
  
  let child;
  
  if (!isPackaged) {
    // Chế độ phát triển (Development): Chạy lệnh qua pnpm workspace
    const filter = serviceName === 'api' ? '@auto-post/api' : (serviceName === 'web' ? '@auto-post/web' : '@auto-post/worker');
    console.log(`🚀 Starting ${serviceName} in dev mode via pnpm...`);
    
    child = spawn('pnpm', ['--filter', filter, 'dev'], {
      shell: true,
      cwd: workspaceRoot
    });
  } else {
    // Chế độ sản phẩm (Production): Chạy trực tiếp các file build dist/.next
    console.log(`🚀 Starting ${serviceName} in production mode...`);
    if (serviceName === 'api') {
      child = spawn('node', [path.join(workspaceRoot, 'apps/api/dist/main.js')], {
        shell: true
      });
    } else if (serviceName === 'web') {
      child = spawn('node', [path.join(workspaceRoot, 'node_modules/next/dist/bin/next'), 'start', '-p', '3005'], {
        shell: true
      });
    } else if (serviceName === 'worker') {
      child = spawn('node', [path.join(workspaceRoot, 'apps/worker/dist/main.js')], {
        shell: true
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
      serviceStates[serviceName] = 'error';
      broadcastStatus();
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
