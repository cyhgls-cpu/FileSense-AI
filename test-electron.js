const { app, BrowserWindow } = require('electron');

let win;

app.on('ready', () => {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadURL('data:text/html,<h1>Hello Electron</h1>');

  win.on('closed', () => {
    console.log('Window closed');
    win = null;
  });

  console.log('Window created');
});

app.on('window-all-closed', () => {
  console.log('All windows closed');
  app.quit();
});
