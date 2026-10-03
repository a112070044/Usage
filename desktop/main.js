// Claude 用量小視窗 — 主程序
//
// 做法：用一個隱藏的瀏覽器視窗（獨立的持久化 session）登入 claude.ai，
// 再在 claude.ai 的網域內呼叫網頁本身使用的 /api/organizations/{org}/usage，
// 結果顯示在一個永遠置頂的小視窗與系統匣（Mac 選單列）上。
// 注意：這是 claude.ai 的內部 API，並非官方公開介面，日後可能變動。
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// CLAUDE_USAGE_ORIGIN 僅供本機測試時指向模擬伺服器
const ORIGIN = process.env.CLAUDE_USAGE_ORIGIN || 'https://claude.ai';
const API_PAGE = `${ORIGIN}/api/organizations`;
const PARTITION = 'persist:claude';
const POLL_MS = 30_000;
const WIDGET_WIDTH = 280; // 含四周 10px 的陰影留白

// 拿掉 User-Agent 裡的 Electron 字樣，讓 claude.ai／Google 登入當成一般 Chrome
app.userAgentFallback = app.userAgentFallback
  .replace(/\s(?:claude-usage-widget|Claude Usage Widget|Electron)\/\S+/g, '');

if (!app.requestSingleInstanceLock()) app.quit();

let widget = null;
let claudeWin = null;
let tray = null;
let quitting = false;
let loginMode = false;
let orgId = null;
let pollTimer = null;
let inflight = null;
let loginPrompted = false;
let widgetShown = false;

const state = { usage: null, fetchedAt: null, error: null, needLogin: false, loading: false };

// ---------- 設定檔 ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = {};
function loadSettings() {
  try { settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { settings = {}; }
}
function saveSettings(patch) {
  Object.assign(settings, patch);
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch {}
}

// ---------- 小視窗 ----------
function initialPosition() {
  const p = settings.position;
  if (p && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return p.x >= a.x - 50 && p.y >= a.y - 10 && p.x < a.x + a.width - 50 && p.y < a.y + a.height - 30;
  })) return p;
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - WIDGET_WIDTH - 6, y: a.y + 6 };
}

function createWidget() {
  const pos = initialPosition();
  widget = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: 160,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  widget.setAlwaysOnTop(true, 'floating');
  widget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  widget.loadFile(path.join(__dirname, 'renderer', 'widget.html'));
  // 第一次依內容調整好大小後才顯示（見 'resize'），避免透明區域閃一下
  widget.on('moved', () => {
    const [x, y] = widget.getPosition();
    saveSettings({ position: { x, y } });
  });
  widget.on('close', (e) => {
    if (!quitting) { e.preventDefault(); setWidgetVisible(false); }
  });
}

function setWidgetVisible(v) {
  if (!widget) return;
  if (v) widget.showInactive(); else widget.hide();
  saveSettings({ hidden: !v });
  updateTray();
}

function broadcast() {
  if (widget && !widget.isDestroyed()) {
    widget.webContents.send('state', { ...state, collapsed: !!settings.collapsed });
  }
  updateTray();
}

// ---------- 隱藏的 claude.ai 視窗（也是登入視窗） ----------
function getClaudeWin() {
  if (claudeWin && !claudeWin.isDestroyed()) return claudeWin;
  claudeWin = new BrowserWindow({
    width: 480,
    height: 760,
    show: false,
    title: '登入 Claude',
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION },
  });
  claudeWin.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: PARTITION } },
  }));
  claudeWin.webContents.on('did-navigate', checkLoginDone);
  claudeWin.webContents.on('did-navigate-in-page', checkLoginDone);
  claudeWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    claudeWin.hide();
    if (loginMode) { loginMode = false; refresh(); }
  });
  return claudeWin;
}

function startLogin() {
  loginMode = true;
  const win = getClaudeWin();
  win.loadURL(`${ORIGIN}/login`);
  win.show();
  win.focus();
}

async function checkLoginDone() {
  if (!loginMode) return;
  const win = getClaudeWin();
  let url;
  try { url = new URL(win.webContents.getURL()); } catch { return; }
  if (url.origin !== ORIGIN || /^\/(login|magic-link|oauth)/.test(url.pathname)) return;
  const cookies = await win.webContents.session.cookies.get({ url: ORIGIN, name: 'sessionKey' });
  if (!cookies.length) return;
  loginMode = false;
  win.hide();
  orgId = null;
  refresh();
}

async function logout() {
  const win = getClaudeWin();
  await win.webContents.session.clearStorageData();
  orgId = null;
  Object.assign(state, { usage: null, fetchedAt: null, error: null, needLogin: true });
  broadcast();
}

// 在 claude.ai 頁面內執行（會被 toString 後注入），只能用頁面裡有的東西
async function pageFetch(orgId) {
  const get = async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    let body = null;
    try { body = await r.json(); } catch {}
    return { status: r.status, body };
  };
  if (!orgId) {
    const o = await get('/api/organizations');
    if (o.status === 401 || o.status === 403) return { login: true };
    if (o.status !== 200 || !Array.isArray(o.body) || !o.body.length) {
      return { error: `取得組織失敗（HTTP ${o.status}）` };
    }
    const chat = o.body.find((x) => Array.isArray(x.capabilities) && x.capabilities.includes('chat'));
    orgId = (chat || o.body[0]).uuid;
  }
  const u = await get(`/api/organizations/${encodeURIComponent(orgId)}/usage`);
  if (u.status === 401) return { login: true };
  if (u.status !== 200) return { error: `取得用量失敗（HTTP ${u.status}）`, resetOrg: true };
  return { orgId, usage: u.body };
}

function refresh() {
  if (loginMode) return Promise.resolve();
  if (inflight) return inflight;
  state.loading = true;
  broadcast();
  inflight = (async () => {
    const win = getClaudeWin();
    let url = '';
    try { url = win.webContents.getURL(); } catch {}
    if (!url.startsWith(ORIGIN)) await win.loadURL(API_PAGE);
    const r = await win.webContents.executeJavaScript(
      `(${pageFetch.toString()})(${JSON.stringify(orgId)})`, true);
    if (r.login) {
      Object.assign(state, { needLogin: true, error: null, usage: null });
      // 第一次發現沒登入時自動打開登入視窗，之後就交給使用者按按鈕
      if (!loginPrompted) { loginPrompted = true; setImmediate(startLogin); }
    } else if (r.error) {
      if (r.resetOrg) orgId = null;
      Object.assign(state, { needLogin: false, error: r.error });
    } else {
      orgId = r.orgId;
      Object.assign(state, { needLogin: false, error: null, usage: r.usage, fetchedAt: Date.now() });
    }
  })()
    .catch((err) => {
      state.error = `連線失敗：${err.message || err}`;
      // 頁面可能壞掉（例如被 Cloudflare 擋），下次重新載入
      try { claudeWin?.webContents.loadURL('about:blank'); } catch {}
    })
    .finally(() => {
      state.loading = false;
      inflight = null;
      broadcast();
    });
  return inflight;
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(refresh, POLL_MS);
  refresh();
}

// ---------- 系統匣／選單列 ----------
function primaryLimit() {
  const u = state.usage;
  if (!u || typeof u !== 'object') return null;
  const v = u.five_hour && typeof u.five_hour.utilization === 'number'
    ? u.five_hour
    : Object.values(u).find((x) => x && typeof x.utilization === 'number');
  return v ? Math.max(0, 100 - v.utilization) : null;
}

function trayText() {
  if (state.needLogin) return '需要登入';
  const left = primaryLimit();
  if (left !== null) return `${Math.round(left)}%`;
  return state.error ? '!' : '…';
}

function updateTray() {
  if (!tray) return;
  const text = trayText();
  if (process.platform === 'darwin') tray.setTitle(` ${text}`);
  tray.setToolTip(`Claude 用量：5 小時額度剩 ${text}`);
  const visible = widget?.isVisible();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `5 小時額度剩餘：${text}`, enabled: false },
    { type: 'separator' },
    { label: visible ? '隱藏小視窗' : '顯示小視窗', click: () => setWidgetVisible(!visible) },
    { label: '立即刷新', click: () => refresh() },
    state.needLogin
      ? { label: '登入 Claude 帳號…', click: startLogin }
      : { label: '登出', click: logout },
    { type: 'separator' },
    {
      label: '開機時自動啟動',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { label: '離開', click: () => { quitting = true; app.quit(); } },
  ]));
}

let defaultTrayIcon = null;

// Windows／Linux：系統匣圖示換成跟著剩餘量變色的小圓環（Mac 用選單列文字顯示）
function setTrayIcon(dataUrl) {
  if (!tray || process.platform === 'darwin') return;
  const img = dataUrl ? nativeImage.createFromDataURL(dataUrl) : null;
  tray.setImage(img && !img.isEmpty() ? img : defaultTrayIcon);
}

function createTray() {
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', file));
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  defaultTrayIcon = icon;
  tray = new Tray(icon);
  tray.on('click', () => setWidgetVisible(!widget?.isVisible()));
  updateTray();
}

// ---------- IPC ----------
ipcMain.on('refresh', () => refresh());
ipcMain.on('login', () => startLogin());
ipcMain.on('hide', () => setWidgetVisible(false));
ipcMain.on('collapse', (_e, collapsed) => { saveSettings({ collapsed: !!collapsed }); broadcast(); });
ipcMain.on('resize', (_e, { width, height }) => {
  if (!widget || widget.isDestroyed()) return;
  const w = Math.ceil(Math.min(Math.max(width, 80), 400));
  const h = Math.ceil(Math.min(Math.max(height, 30), 600));
  const [cw, ch] = widget.getContentSize();
  if (cw !== w || ch !== h) widget.setContentSize(w, h);
  if (!widgetShown) {
    widgetShown = true;
    if (settings.hidden !== true) widget.showInactive();
    updateTray();
  }
});
ipcMain.on('tray-icon', (_e, dataUrl) => setTrayIcon(dataUrl));
ipcMain.handle('get-state', () => ({ ...state, collapsed: !!settings.collapsed }));

// ---------- 啟動 ----------
app.on('second-instance', () => setWidgetVisible(true));
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', (e) => e.preventDefault());

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide();
  loadSettings();
  createWidget();
  createTray();
  startPolling();
});
