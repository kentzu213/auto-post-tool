const { contextBridge, ipcRenderer } = require('electron');

// Thiết lập cầu nối an toàn giữa Main Process và Renderer Process
contextBridge.exposeInMainWorld('electronAPI', {
  // Nhận thông tin trạng thái dịch vụ từ Main Process
  onServiceUpdate: (callback) => ipcRenderer.on('service-status-update', callback),

  // Nhận thông điệp lỗi chi tiết theo từng dịch vụ
  onServiceError: (callback) => ipcRenderer.on('service-error-update', callback),

  // Gửi lệnh yêu cầu kiểm tra hoặc thử kết nối lại
  retryServices: () => ipcRenderer.send('retry-services-check')
});
