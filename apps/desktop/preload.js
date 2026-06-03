const { contextBridge, ipcRenderer } = require('electron');

// Cầu nối an toàn cho cửa sổ nhập URL máy chủ (first-run prompt / đổi URL).
// Bản thin-client không còn theo dõi trạng thái dịch vụ cục bộ nữa.
contextBridge.exposeInMainWorld('izziPrompt', {
  // Lấy URL mặc định để điền sẵn vào ô nhập
  getDefault: () => ipcRenderer.invoke('izzi-prompt-default'),

  // Gửi URL người dùng nhập về Main Process
  submit: (url) => ipcRenderer.send('izzi-prompt-submit', url),

  // Huỷ nhập (giữ nguyên / dùng URL mặc định)
  cancel: () => ipcRenderer.send('izzi-prompt-cancel')
});
