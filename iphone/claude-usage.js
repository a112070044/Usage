// Claude 用量 — iPhone 主畫面／鎖定畫面小工具（Scriptable）
//
// 做法：在 Scriptable 內建的瀏覽器（WebView）登入 claude.ai 一次，
// 之後在 claude.ai 的頁面裡呼叫網頁本身使用的 /api/organizations/{org}/usage。
// 登入資訊只留在 Scriptable 的瀏覽器裡，不會被讀出或傳到別的地方。
// 注意：這是 claude.ai 的內部 API，並非官方公開介面，日後可能變動。

const ORIGIN = 'https://claude.ai';
const REFRESH_MIN = 5; // 希望的刷新間隔；實際由 iOS 決定（通常 15 分鐘以上）

const LABELS = {
  five_hour: '5 小時',
  seven_day: '7 天',
  seven_day_opus: '7 天 Opus',
  seven_day_sonnet: '7 天 Sonnet',
  seven_day_oauth_apps: '7 天 外部應用',
};
const ORDER = Object.keys(LABELS);

const C = {
  bg: Color.dynamic(new Color('#faf9f5'), new Color('#262624')),
  fg: Color.dynamic(new Color('#1f2937'), new Color('#f3f4f6')),
  muted: Color.dynamic(new Color('#6b7280'), new Color('#a1a1aa')),
  track: Color.dynamic(new Color('#000000', 0.08), new Color('#ffffff', 0.14)),
  accent: new Color('#c96442'),
  ok: new Color('#16a34a'),
  warn: new Color('#d97706'),
  crit: new Color('#dc2626'),
};

// ---------- 快取（抓不到時顯示上一次的資料） ----------
const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), 'claude-usage-cache.json');

function readCache() {
  try { return JSON.parse(fm.readString(CACHE)) || {}; } catch { return {}; }
}
function writeCache(c) {
  try { fm.writeString(CACHE, JSON.stringify(c)); } catch {}
}

// ---------- 取得用量 ----------
// 這段會在 claude.ai 頁面裡執行
const PAGE_JS = (orgId) => `
(async () => {
  const get = async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    let body = null;
    try { body = await r.json(); } catch (e) {}
    return { status: r.status, body };
  };
  let org = ${JSON.stringify(orgId || null)};
  if (!org) {
    const o = await get('/api/organizations');
    if (o.status === 401 || o.status === 403) return { login: true };
    if (o.status !== 200 || !Array.isArray(o.body) || !o.body.length) {
      return { error: '取得組織失敗（HTTP ' + o.status + '）' };
    }
    const chat = o.body.find((x) => Array.isArray(x.capabilities) && x.capabilities.includes('chat'));
    org = (chat || o.body[0]).uuid;
  }
  const u = await get('/api/organizations/' + encodeURIComponent(org) + '/usage');
  if (u.status === 401 || u.status === 403) return { login: true, resetOrg: u.status === 403 };
  if (u.status !== 200) return { error: '取得用量失敗（HTTP ' + u.status + '）', resetOrg: true };
  return { orgId: org, usage: u.body };
})().then(
  (r) => completion(JSON.stringify(r)),
  (e) => completion(JSON.stringify({ error: String((e && e.message) || e) })),
);
// 最後一行必須是簡單的值：WKWebView 不接受把 Promise 當成執行結果傳回
null;
`;

async function fetchUsage(orgId) {
  const wv = new WebView();
  await wv.loadURL(`${ORIGIN}/api/organizations`);
  const json = await wv.evaluateJavaScript(PAGE_JS(orgId), true);
  return typeof json === 'string' ? JSON.parse(json) : json;
}

async function login() {
  const wv = new WebView();
  await wv.loadURL(`${ORIGIN}/login`);
  await wv.present(false);
}

// ---------- 資料整理 ----------
function limits(data) {
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data)
    .filter(([, v]) => v && typeof v === 'object' && typeof v.utilization === 'number')
    .map(([key, v]) => {
      const used = Math.max(0, Math.min(100, v.utilization));
      return {
        key,
        label: LABELS[key] || key,
        used,
        left: 100 - used,
        resetsAt: v.resets_at ? new Date(v.resets_at) : null,
      };
    })
    .sort((a, b) => rank(a.key) - rank(b.key));
}
function rank(k) { return ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length; }

function levelColor(left) {
  if (left <= 10) return C.crit;
  if (left <= 30) return C.warn;
  return C.ok;
}

function hhmm(ts) {
  const df = new DateFormatter();
  df.dateFormat = 'HH:mm';
  return df.string(new Date(ts));
}

// ---------- 小工具畫面 ----------
function bar(used, color, width, height = 6) {
  const dc = new DrawContext();
  dc.size = new Size(width, height);
  dc.opaque = false;
  dc.respectScreenScale = true;
  const track = new Path();
  track.addRoundedRect(new Rect(0, 0, width, height), height / 2, height / 2);
  dc.addPath(track);
  dc.setFillColor(C.track);
  dc.fillPath();
  const w = Math.max(height, (width * used) / 100);
  if (used > 0) {
    const fill = new Path();
    fill.addRoundedRect(new Rect(0, 0, w, height), height / 2, height / 2);
    dc.addPath(fill);
    dc.setFillColor(color);
    dc.fillPath();
  }
  return dc.getImage();
}

function addResetLine(stack, r, size) {
  if (!r.resetsAt) return;
  const line = stack.addStack();
  line.centerAlignContent();
  const pre = line.addText('重置 ');
  pre.font = Font.systemFont(size);
  pre.textColor = C.muted;
  const d = line.addDate(r.resetsAt);
  d.applyRelativeStyle(); // 會自己倒數，不必等小工具刷新
  d.font = Font.systemFont(size);
  d.textColor = C.muted;
  d.lineLimit = 1;
}

function addFooter(w, view) {
  w.addSpacer();
  const t = w.addText(view.footer);
  t.font = Font.systemFont(9);
  t.textColor = view.stale ? C.warn : C.muted;
  t.lineLimit = 1;
}

function addHeader(w, primary) {
  const head = w.addStack();
  head.centerAlignContent();
  const title = head.addText('Claude 用量');
  title.font = Font.semiboldSystemFont(12);
  title.textColor = C.accent;
  head.addSpacer();
  if (primary) {
    const pct = head.addText(`${Math.round(primary.left)}%`);
    pct.font = Font.boldSystemFont(12);
    pct.textColor = levelColor(primary.left);
  }
}

function messageWidget(w, msg) {
  const t = w.addText('Claude 用量');
  t.font = Font.semiboldSystemFont(12);
  t.textColor = C.accent;
  w.addSpacer(6);
  const m = w.addText(msg);
  m.font = Font.systemFont(12);
  m.textColor = C.fg;
}

function smallWidget(w, rows, view) {
  const p = rows[0];
  const title = w.addText(`Claude · ${p.label}`);
  title.font = Font.semiboldSystemFont(11);
  title.textColor = C.accent;
  w.addSpacer(4);
  const big = w.addText(`剩 ${Math.round(p.left)}%`);
  big.font = Font.boldRoundedSystemFont(30);
  big.textColor = levelColor(p.left);
  big.minimumScaleFactor = 0.6;
  w.addSpacer(4);
  w.addImage(bar(p.used, levelColor(p.left), 120));
  w.addSpacer(4);
  addResetLine(w, p, 10);
  const other = rows.find((r) => r.key === 'seven_day') || rows[1];
  if (other && other !== p) {
    w.addSpacer(4);
    const t = w.addText(`${other.label} 剩 ${Math.round(other.left)}%`);
    t.font = Font.mediumSystemFont(11);
    t.textColor = levelColor(other.left);
  }
  addFooter(w, view);
}

function listWidget(w, rows, view, max, barWidth) {
  addHeader(w, rows[0]);
  for (const r of rows.slice(0, max)) {
    w.addSpacer(6);
    const line = w.addStack();
    line.centerAlignContent();
    const l = line.addText(r.label);
    l.font = Font.systemFont(11);
    l.textColor = C.muted;
    line.addSpacer();
    const v = line.addText(`剩 ${Math.round(r.left)}%`);
    v.font = Font.boldSystemFont(12);
    v.textColor = levelColor(r.left);
    w.addSpacer(3);
    w.addImage(bar(r.used, levelColor(r.left), barWidth));
    w.addSpacer(2);
    addResetLine(w, r, 9);
  }
  addFooter(w, view);
}

// 中尺寸：一行一項（名稱｜進度條｜剩餘），只有第一項顯示重置倒數
function compactWidget(w, rows, view) {
  addHeader(w, rows[0]);
  rows.slice(0, 3).forEach((r, i) => {
    w.addSpacer(7);
    const line = w.addStack();
    line.centerAlignContent();
    const l = line.addStack();
    l.size = new Size(78, 0);
    const lt = l.addText(r.label);
    lt.font = Font.systemFont(11);
    lt.textColor = C.muted;
    lt.lineLimit = 1;
    line.addImage(bar(r.used, levelColor(r.left), 160));
    line.addSpacer();
    const v = line.addText(`剩 ${Math.round(r.left)}%`);
    v.font = Font.boldSystemFont(12);
    v.textColor = levelColor(r.left);
    if (i === 0) { w.addSpacer(2); addResetLine(w, r, 9); }
  });
  addFooter(w, view);
}

function buildWidget(view, family) {
  const w = new ListWidget();
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60_000);
  const rows = limits(view.usage);
  const p = rows[0];

  // 鎖定畫面
  if (family === 'accessoryInline') {
    w.addText(p ? `Claude ${p.label} 剩 ${Math.round(p.left)}%` : `Claude：${view.short}`);
    return w;
  }
  if (family === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const t = w.addText(p ? `${Math.round(p.left)}%` : '!');
    t.font = Font.boldRoundedSystemFont(16);
    t.centerAlignText();
    const s = w.addText(p ? (p.key === 'five_hour' ? '5h' : '7d') : 'Claude');
    s.font = Font.systemFont(9);
    s.centerAlignText();
    return w;
  }
  if (family === 'accessoryRectangular') {
    if (!p) { w.addText(`Claude：${view.short}`); return w; }
    const t = w.addText(`Claude ${p.label} 剩 ${Math.round(p.left)}%`);
    t.font = Font.semiboldSystemFont(12);
    const other = rows.find((r) => r.key === 'seven_day');
    if (other && other !== p) {
      const o = w.addText(`${other.label} 剩 ${Math.round(other.left)}%`);
      o.font = Font.systemFont(11);
    }
    addResetLine(w, p, 11);
    return w;
  }

  // 主畫面
  w.backgroundColor = C.bg;
  w.setPadding(12, 12, 12, 12);
  if (!p) {
    messageWidget(w, view.message);
    addFooter(w, view);
    return w;
  }
  if (family === 'small') smallWidget(w, rows, view);
  else if (family === 'large') listWidget(w, rows, view, 6, 290);
  else compactWidget(w, rows, view);
  return w;
}

// ---------- 主程式 ----------
async function load() {
  const cache = readCache();
  let r;
  try {
    r = await fetchUsage(cache.orgId);
  } catch (e) {
    r = { error: `連線失敗：${e.message || e}` };
  }
  if (r && r.resetOrg) delete cache.orgId;
  if (r && r.usage) {
    Object.assign(cache, { orgId: r.orgId, usage: r.usage, fetchedAt: Date.now() });
    writeCache(cache);
    return { usage: r.usage, footer: `更新於 ${hhmm(cache.fetchedAt)}`, short: '', message: '' };
  }
  writeCache(cache);
  const needLogin = !!(r && r.login);
  const reason = needLogin ? '需要登入' : ((r && r.error) || '讀取失敗');
  if (cache.usage && !needLogin) {
    // 抓不到就先顯示上一次的結果
    return { usage: cache.usage, stale: true, footer: `⚠ 舊資料 ${hhmm(cache.fetchedAt)}・點一下更新`, short: reason, message: reason };
  }
  return {
    usage: null,
    needLogin,
    stale: true,
    footer: '點一下小工具處理',
    short: reason,
    message: needLogin ? '請點一下小工具，登入你的 Claude 帳號。' : `${reason}\n點一下小工具重試。`,
  };
}

async function runInApp() {
  let view = await load();
  if (view.needLogin) {
    const a = new Alert();
    a.title = '登入 Claude';
    a.message = '接下來會打開 claude.ai 登入頁面。\n\n建議用「Email」登入（Google 登入可能會被擋）。登入完成、看到聊天畫面後，按左上角「Close／關閉」即可。';
    a.addAction('前往登入');
    a.addCancelAction('取消');
    if ((await a.present()) === 0) {
      await login();
      view = await load();
    }
  }

  const menu = new Alert();
  menu.title = 'Claude 用量';
  const rows = limits(view.usage);
  menu.message = rows.length
    ? rows.map((r) => `${r.label}：剩 ${Math.round(r.left)}%`).join('\n') + `\n\n${view.footer}`
    : view.message;
  menu.addAction('預覽小工具（小）');
  menu.addAction('預覽小工具（中）');
  menu.addAction('預覽小工具（大）');
  menu.addAction('重新登入 claude.ai');
  menu.addCancelAction('完成');
  const choice = await menu.presentSheet();
  if (choice === 0) await buildWidget(view, 'small').presentSmall();
  if (choice === 1) await buildWidget(view, 'medium').presentMedium();
  if (choice === 2) await buildWidget(view, 'large').presentLarge();
  if (choice === 3) await login();
}

if (config.runsInWidget) {
  const view = await load();
  Script.setWidget(buildWidget(view, config.widgetFamily));
} else {
  await runInApp();
}
Script.complete();
