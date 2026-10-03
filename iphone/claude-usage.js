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

// 小工具上顯示的短名稱
const SHORT = {
  five_hour: '5 小時',
  seven_day: '7 天',
  seven_day_opus: 'Opus',
  seven_day_sonnet: 'Sonnet',
  seven_day_oauth_apps: '外部應用',
};

const C = {
  bg: Color.dynamic(new Color('#ffffff'), new Color('#1c1c1e')),
  fg: Color.dynamic(new Color('#1c1c1e'), new Color('#f5f5f7')),
  muted: Color.dynamic(new Color('#6e6e73'), new Color('#98989d')),
  accent: new Color('#d97757'),
  ok: Color.dynamic(new Color('#28a745'), new Color('#30d158')),
  warn: Color.dynamic(new Color('#f08c00'), new Color('#ff9f0a')),
  crit: Color.dynamic(new Color('#e5372c'), new Color('#ff453a')),
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
      let used = Math.max(0, Math.min(100, v.utilization));
      let resetsAt = v.resets_at ? new Date(v.resets_at) : null;
      // 快取的資料可能已經過了重置時間：那個額度已經歸零重來
      const wasReset = !!resetsAt && resetsAt.getTime() <= Date.now();
      if (wasReset) { used = 0; resetsAt = null; }
      return { key, label: LABELS[key] || key, short: SHORT[key] || LABELS[key] || key, used, left: 100 - used, resetsAt, wasReset };
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
// 風格參考 iOS 內建的電池小工具：圓環＝剩餘量，綠／橘／紅表示充足／偏少／快用完。

// 畫成圖片的部分（圓環、進度條）不用 Color.dynamic，選深淺背景都看得清楚的顏色
const IMG = {
  track: new Color('#8e8e93', 0.28),
  lockTrack: new Color('#ffffff', 0.28),
  lock: Color.white(),
  ok: new Color('#34c759'),
  warn: new Color('#ff9f0a'),
  crit: new Color('#ff453a'),
};
function imgColor(left) {
  if (left <= 10) return IMG.crit;
  if (left <= 30) return IMG.warn;
  return IMG.ok;
}

function ringImage(left, color, size, lineWidth, track = IMG.track) {
  const dc = new DrawContext();
  dc.size = new Size(size, size);
  dc.opaque = false;
  dc.respectScreenScale = true;
  const inset = lineWidth / 2;
  dc.setLineWidth(lineWidth);
  dc.setStrokeColor(track);
  dc.strokeEllipse(new Rect(inset, inset, size - lineWidth, size - lineWidth));
  if (left > 0) {
    const c = size / 2;
    const r = (size - lineWidth) / 2;
    const sweep = (Math.min(left, 100) / 100) * Math.PI * 2;
    const steps = Math.max(2, Math.ceil(left * 1.5));
    const pt = (a) => new Point(c + r * Math.cos(a), c + r * Math.sin(a));
    const start = -Math.PI / 2;
    const path = new Path();
    path.move(pt(start));
    for (let i = 1; i <= steps; i++) path.addLine(pt(start + (sweep * i) / steps));
    dc.addPath(path);
    dc.setStrokeColor(color);
    dc.strokePath();
    // 圓頭端點
    dc.setFillColor(color);
    for (const a of [start, start + sweep]) {
      const p = pt(a);
      dc.fillEllipse(new Rect(p.x - inset, p.y - inset, lineWidth, lineWidth));
    }
  }
  return dc.getImage();
}

function barImage(left, color, width, height = 5, track = IMG.track) {
  const dc = new DrawContext();
  dc.size = new Size(width, height);
  dc.opaque = false;
  dc.respectScreenScale = true;
  const rr = (w) => {
    const p = new Path();
    p.addRoundedRect(new Rect(0, 0, w, height), height / 2, height / 2);
    return p;
  };
  dc.addPath(rr(width));
  dc.setFillColor(track);
  dc.fillPath();
  if (left > 0) {
    dc.addPath(rr(Math.max(height, (width * Math.min(left, 100)) / 100)));
    dc.setFillColor(color);
    dc.fillPath();
  }
  return dc.getImage();
}

// 重置時間顯示成時刻（「14:39」「明天 09:00」「10/6 週一」），不會因為資料舊了而算錯
function resetWhen(r) {
  if (r.wasReset) return '已重置';
  if (!r.resetsAt) return '';
  const d = r.resetsAt;
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const df = new DateFormatter();
  df.locale = 'zh_TW';
  if (d.toDateString() === now.toDateString()) {
    df.dateFormat = 'HH:mm';
    return df.string(d);
  }
  if (d.toDateString() === tomorrow.toDateString()) {
    df.dateFormat = 'HH:mm';
    return `明天 ${df.string(d)}`;
  }
  df.dateFormat = 'M/d EEE';
  return df.string(d);
}
function resetLine(r) {
  const w = resetWhen(r);
  if (!w || r.wasReset) return w;
  return `${w} 重置`;
}

function text(stack, str, font, color = C.fg, opts = {}) {
  const t = stack.addText(str);
  t.font = font;
  t.textColor = color;
  t.lineLimit = opts.lines || 1;
  if (opts.scale) t.minimumScaleFactor = opts.scale;
  return t;
}

function updatedLabel(view) {
  if (!view.fetchedAt) return '';
  return view.fresh ? `${hhmm(view.fetchedAt)} 更新` : `${hhmm(view.fetchedAt)} 的數字`;
}

function addHeader(w, view, title = 'Claude') {
  const head = w.addStack();
  head.centerAlignContent();
  text(head, '✻', Font.boldSystemFont(13), C.accent);
  head.addSpacer(4);
  text(head, title, Font.semiboldSystemFont(13), C.fg);
  head.addSpacer();
  const u = updatedLabel(view);
  if (u) text(head, view.stale ? `⚠ ${u}` : u, Font.mediumSystemFont(10), view.stale ? C.warn : C.muted, { scale: 0.7 });
  return head;
}

// 圓環＋中間的百分比
function addRing(parent, r, size, lineWidth, fontSize, caption) {
  const ring = parent.addStack();
  ring.size = new Size(size, size);
  ring.backgroundImage = ringImage(r ? r.left : 0, r ? imgColor(r.left) : IMG.track, size, lineWidth);
  ring.layoutVertically();
  ring.centerAlignContent();
  ring.addSpacer();
  const row = ring.addStack();
  row.addSpacer();
  const num = row.addStack();
  num.bottomAlignContent();
  text(num, r ? `${Math.round(r.left)}` : '—', Font.boldRoundedSystemFont(fontSize), C.fg);
  if (r) text(num, '%', Font.boldRoundedSystemFont(fontSize * 0.55), C.muted);
  row.addSpacer();
  if (caption) {
    const cap = ring.addStack();
    cap.addSpacer();
    text(cap, caption, Font.mediumSystemFont(Math.max(8, fontSize * 0.42)), C.muted);
    cap.addSpacer();
  }
  ring.addSpacer();
  return ring;
}

// 圓環欄：圓環、名稱、重置時間（置中）
function addRingColumn(parent, r, width, size) {
  const col = parent.addStack();
  col.layoutVertically();
  col.centerAlignContent();
  col.size = new Size(width, 0);
  addRing(col, r, size, Math.round(size * 0.11), Math.round(size * 0.3));
  col.addSpacer(5);
  const l = col.addStack();
  l.addSpacer();
  text(l, r.short, Font.semiboldSystemFont(11), C.fg);
  l.addSpacer();
  const when = resetWhen(r);
  if (when) {
    col.addSpacer(1);
    const t = col.addStack();
    t.addSpacer();
    text(t, when, Font.systemFont(9), C.muted, { scale: 0.7 });
    t.addSpacer();
  }
}

// 條狀列：名稱｜剩 xx%，下面一條進度條與重置時間
function addBarRow(parent, r, width, showReset = true) {
  const row = parent.addStack();
  row.layoutVertically();
  const top = row.addStack();
  top.size = new Size(width, 0);
  top.centerAlignContent();
  text(top, r.label, Font.mediumSystemFont(11), C.muted);
  top.addSpacer();
  text(top, `${Math.round(r.left)}%`, Font.boldRoundedSystemFont(13), levelColor(r.left));
  row.addSpacer(3);
  row.addImage(barImage(r.left, imgColor(r.left), width)).imageSize = new Size(width, 5);
  if (showReset) {
    const rl = resetLine(r);
    if (rl) {
      row.addSpacer(2);
      text(row, rl, Font.systemFont(9), C.muted);
    }
  }
}

function messageBody(w, view) {
  w.addSpacer();
  const box = w.addStack();
  box.centerAlignContent();
  addRing(box, null, 46, 5, 14);
  box.addSpacer(10);
  const col = box.addStack();
  col.layoutVertically();
  text(col, view.message, Font.mediumSystemFont(12), C.fg, { lines: 3, scale: 0.8 });
  col.addSpacer(3);
  text(col, '點一下更新', Font.semiboldSystemFont(11), C.accent);
  w.addSpacer();
}

function smallWidget(w, rows, view) {
  addHeader(w, view);
  w.addSpacer();
  const p = rows[0];
  const second = rows.find((r) => r.key === 'seven_day' && r !== p) || rows[1];
  const line = w.addStack();
  if (second) {
    addRingColumn(line, p, 62, 58);
    line.addSpacer();
    addRingColumn(line, second, 62, 58);
  } else {
    line.addSpacer();
    addRingColumn(line, p, 90, 76);
    line.addSpacer();
  }
  w.addSpacer();
}

function mediumWidget(w, rows, view) {
  addHeader(w, view, 'Claude 用量');
  w.addSpacer();
  const body = w.addStack();
  body.centerAlignContent();
  const p = rows[0];
  addRing(body, p, 92, 10, 26, p.short);
  body.addSpacer(16);
  const right = body.addStack();
  right.layoutVertically();
  const rl = resetLine(p);
  text(right, rl ? `${p.label}額度・${rl}` : `${p.label}額度`, Font.mediumSystemFont(11), C.muted, { scale: 0.8 });
  const others = rows.slice(1, 4);
  for (const r of others) {
    right.addSpacer(others.length > 2 ? 6 : 9);
    addBarRow(right, r, 186, others.length <= 2);
  }
  if (!others.length) {
    right.addSpacer(6);
    text(right, `已用 ${Math.round(p.used)}%`, Font.mediumSystemFont(12), C.fg);
  }
  w.addSpacer();
}

// 大尺寸：上面兩個大圓環（5 小時、7 天），下面列出其他額度
function largeWidget(w, rows, view) {
  addHeader(w, view, 'Claude 用量');
  w.addSpacer();
  const p = rows[0];
  const second = rows.find((r) => r.key === 'seven_day' && r !== p) || rows[1];
  const hero = w.addStack();
  for (const r of [p, second].filter(Boolean)) {
    hero.addSpacer();
    const col = hero.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    addRing(col, r, 112, 12, 34, r.short);
    col.addSpacer(8);
    const rl = resetLine(r);
    if (rl) {
      const t = col.addStack();
      t.addSpacer();
      text(t, rl, Font.mediumSystemFont(12), C.fg);
      t.addSpacer();
    }
    const u = col.addStack();
    u.addSpacer();
    text(u, `已用 ${Math.round(r.used)}%`, Font.systemFont(11), C.muted);
    u.addSpacer();
  }
  hero.addSpacer();
  const others = rows.filter((r) => r !== p && r !== second).slice(0, 3);
  if (others.length) {
    w.addSpacer(16);
    others.forEach((r, i) => {
      if (i) w.addSpacer(10);
      addBarRow(w, r, 306);
    });
  }
  w.addSpacer();
  const foot = w.addStack();
  foot.addSpacer();
  text(foot, '點一下小工具更新', Font.systemFont(10), C.muted);
  foot.addSpacer();
}

function lockCircular(w, rows) {
  const p = rows[0];
  w.addAccessoryWidgetBackground = true;
  const ring = w.addStack();
  ring.size = new Size(58, 58);
  ring.backgroundImage = ringImage(p ? p.left : 0, IMG.lock, 58, 5, IMG.lockTrack);
  ring.layoutVertically();
  ring.centerAlignContent();
  ring.addSpacer();
  const a = ring.addStack();
  a.addSpacer();
  text(a, p ? `${Math.round(p.left)}` : '—', Font.boldRoundedSystemFont(18), Color.white());
  a.addSpacer();
  const b = ring.addStack();
  b.addSpacer();
  text(b, p ? (p.key === 'five_hour' ? '5h' : '7d') : '✻', Font.semiboldSystemFont(9), Color.white());
  b.addSpacer();
  ring.addSpacer();
}

function lockRectangular(w, rows, view) {
  const head = w.addStack();
  head.centerAlignContent();
  text(head, '✻ Claude', Font.semiboldSystemFont(12), Color.white());
  head.addSpacer();
  const p = rows[0];
  if (p && resetWhen(p)) text(head, resetWhen(p), Font.systemFont(10), Color.white(), { scale: 0.8 });
  if (!p) {
    text(w, view.short || '點一下更新', Font.systemFont(12), Color.white());
    return;
  }
  for (const r of rows.slice(0, 2)) {
    w.addSpacer(3);
    const line = w.addStack();
    line.centerAlignContent();
    const l = line.addStack();
    l.size = new Size(40, 0);
    text(l, r.short, Font.mediumSystemFont(11), Color.white());
    line.addSpacer(4);
    line.addImage(barImage(r.left, IMG.lock, 80, 5, IMG.lockTrack)).imageSize = new Size(80, 5);
    line.addSpacer(6);
    text(line, `${Math.round(r.left)}%`, Font.boldRoundedSystemFont(12), Color.white());
  }
}

function buildWidget(view, family) {
  const w = new ListWidget();
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60_000);
  const rows = limits(view.usage);
  const p = rows[0];

  // 鎖定畫面
  if (family === 'accessoryInline') {
    const second = rows.find((r) => r.key === 'seven_day' && r !== p);
    w.addText(p
      ? `✻ ${p.short} ${Math.round(p.left)}%${second ? ` · ${second.short} ${Math.round(second.left)}%` : ''}`
      : `✻ Claude：${view.short}`);
    return w;
  }
  if (family === 'accessoryCircular') { lockCircular(w, rows); return w; }
  if (family === 'accessoryRectangular') { lockRectangular(w, rows, view); return w; }

  // 主畫面
  w.backgroundColor = C.bg;
  w.setPadding(14, 14, 14, 14);
  if (!p) {
    addHeader(w, view);
    messageBody(w, view);
    return w;
  }
  if (family === 'small') smallWidget(w, rows, view);
  else if (family === 'large') largeWidget(w, rows, view);
  else mediumWidget(w, rows, view);
  return w;
}

// ---------- 主程式 ----------
// 小工具在背景執行時，iOS 不讓它使用 Scriptable App 裡瀏覽器的登入狀態，
// 所以通常抓不到；這時改顯示上一次在 App 裡抓到的結果（存在快取）。
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
    return { usage: r.usage, fresh: true, fetchedAt: cache.fetchedAt, footer: `更新於 ${hhmm(cache.fetchedAt)}`, short: '', message: '' };
  }
  writeCache(cache);
  const needLogin = !!(r && r.login);
  const reason = needLogin ? '需要登入' : ((r && r.error) || '讀取失敗');
  if (cache.usage) {
    const old = Date.now() - cache.fetchedAt > 60 * 60_000;
    return {
      usage: cache.usage,
      needLogin,
      fetchedAt: cache.fetchedAt,
      stale: old,
      footer: `${hhmm(cache.fetchedAt)} 的數字・點一下更新`,
      short: reason,
      message: reason,
    };
  }
  return {
    usage: null,
    needLogin,
    stale: true,
    footer: '點一下小工具更新',
    short: '點一下更新',
    message: config.runsInWidget ? '還沒有資料' : reason,
  };
}

async function askLogin() {
  const a = new Alert();
  a.title = '登入 Claude';
  a.message = '接下來會打開 claude.ai 登入頁面。\n\n建議用「Email」登入（Google 登入可能會被擋）。登入完成、看到聊天畫面後，按左上角「Close／關閉」即可。';
  a.addAction('前往登入');
  a.addCancelAction('取消');
  if ((await a.present()) !== 0) return false;
  await login();
  return true;
}

async function preview(view, family) {
  const w = buildWidget(view, family);
  if (family === 'small') await w.presentSmall();
  else if (family === 'large') await w.presentLarge();
  else await w.presentMedium();
}

async function runInApp() {
  let view = await load();
  if (view.needLogin && !view.fresh && (await askLogin())) view = await load();

  const q = (typeof args !== 'undefined' && args.queryParameters) || {};
  if (q.from === 'widget') {
    // 從主畫面小工具點進來：直接顯示最新結果
    await preview(view, q.family || 'medium');
    return;
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
  if (choice === 0) await preview(view, 'small');
  if (choice === 1) await preview(view, 'medium');
  if (choice === 2) await preview(view, 'large');
  if (choice === 3) await login();
}

if (config.runsInWidget) {
  const view = await load();
  const w = buildWidget(view, config.widgetFamily);
  w.url = `${URLScheme.forRunningScript()}?from=widget&family=${encodeURIComponent(config.widgetFamily || 'medium')}`;
  Script.setWidget(w);
} else {
  await runInApp();
}
Script.complete();
