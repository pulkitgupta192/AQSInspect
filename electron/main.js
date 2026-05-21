const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

// Avoid GPU / cache permission issues in restricted environments
try {
  app.commandLine.appendSwitch('disable-gpu');
  app.disableHardwareAcceleration();
} catch (e) {
  console.warn('Could not disable GPU acceleration:', e && e.message);
}

// Ensure userData path exists to avoid "Access is denied" on some systems
try {
  const userDataPath = app.getPath('userData');
  fs.mkdirSync(userDataPath, { recursive: true });
} catch (e) {
  console.warn('Failed to ensure userData directory exists:', e && e.message);
}

// Load IPC handlers after ensuring storage paths exist
require("./ipcHandlers");

function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (!app.isPackaged) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});