const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  // Tạo cửa sổ không viền Frameless Glassmorphic đẳng cấp
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    title: 'Auto-Post Tool Dashboard',
    backgroundColor: '#090d16',
    show: false,
    frame: false, // Bật không viền Frameless
    titleBarStyle: 'hidden', // Ẩn thanh tiêu đề mặc định
    titleBarOverlay: {
      color: '#090d16', // Trộn màu nền chìm vào giao diện
      symbolColor: '#94a3b8', // Màu icon điều khiển (Thu nhỏ, Đóng, Phóng to)
      height: 40 // Chiều cao thanh chìm
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Tắt thanh Menu Bar File/Edit
  mainWindow.setMenuBarVisibility(false);

  // Thử lại kết nối Next.js server cổng 3005 (chống lỗi khi Next.js đang khởi chạy)
  function loadWithRetry() {
    mainWindow.loadURL('http://localhost:3005').catch(() => {
      console.log('⏳ Next.js server is starting... retrying in 1s...');
      setTimeout(loadWithRetry, 1000);
    });
  }

  loadWithRetry();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});
