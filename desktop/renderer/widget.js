// 小視窗畫面：與 iPhone 小工具相同的圓環風格（圓環＝剩餘量）
const LABELS = {
  five_hour: '5 小時',
  seven_day: '7 天',
  seven_day_opus: '7 天 Opus',
  seven_day_sonnet: '7 天 Sonnet',
  seven_day_oauth_apps: '7 天 外部應用',
};
const ORDER = Object.keys(LABELS);
const rank = (k) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);
const SVG = 'http://www.w3.org/2000/svg';
const MARGIN = 10; // #panel 四周留給陰影的空間

const $panel = document.getElementById('panel');
const $body = document.getElementById('body');
const $foot = document.getElementById('foot');
const $time = document.getElementById('time');
const $mini = document.getElementById('mini');
const $refresh = document.getElementById('refresh');

let state = {};

function limits(data) {
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data)
    .filter(([, v]) => v && typeof v === 'object' && typeof v.utilization === 'number')
    .map(([key, v]) => {
      let used = Math.max(0, Math.min(100, v.utilization));
      let resetsAt = v.resets_at ? new Date(v.resets_at) : null;
      const wasReset = !!resetsAt && resetsAt.getTime() <= Date.now();
      if (wasReset) { used = 0; resetsAt = null; }
      return { key, label: LABELS[key] ?? key, used, left: 100 - used, resetsAt, wasReset };
    })
    .sort((a, b) => rank(a.key) - rank(b.key));
}

function level(left) {
  if (left <= 10) return 'crit';
  if (left <= 30) return 'warn';
  return 'ok';
}

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// 重置時間顯示成時刻：「14:39 重置」「明天 08:20 重置」「10/6 週二 重置」
function resetText(r) {
  if (r.wasReset) return '已重置';
  if (!r.resetsAt) return '';
  const d = r.resetsAt;
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (d.toDateString() === now.toDateString()) return `${hhmm(d)} 重置`;
  if (d.toDateString() === tomorrow.toDateString()) return `明天 ${hhmm(d)} 重置`;
  return `${d.getMonth() + 1}/${d.getDate()} 週${'日一二三四五六'[d.getDay()]} 重置`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function ringSvg(left, size, stroke) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const len = 2 * Math.PI * r;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  for (const [cls, dash] of [['track', null], ['arc', (len * left) / 100]]) {
    if (cls === 'arc' && left <= 0) continue;
    const ci = document.createElementNS(SVG, 'circle');
    ci.setAttribute('class', cls);
    ci.setAttribute('cx', c);
    ci.setAttribute('cy', c);
    ci.setAttribute('r', r);
    ci.setAttribute('stroke-width', stroke);
    if (dash != null) ci.setAttribute('stroke-dasharray', `${dash} ${len}`);
    svg.appendChild(ci);
  }
  return svg;
}

function ringColumn(r) {
  const col = el('div', 'ring-col');
  col.dataset.level = level(r.left);
  const ring = el('div', 'ring');
  ring.appendChild(ringSvg(r.left, 84, 9));
  const num = el('div', 'num');
  const line = el('span');
  line.append(el('b', '', `${Math.round(r.left)}`), el('small', '', '%'));
  num.appendChild(line);
  ring.appendChild(num);
  ring.title = `已用 ${Math.round(r.used)}%`;
  col.append(ring, el('span', 'ring-label', r.label), el('span', 'ring-reset', resetText(r)));
  if (r.resetsAt) col.querySelector('.ring-reset').title = r.resetsAt.toLocaleString('zh-TW', { hour12: false });
  return col;
}

function barRow(r) {
  const row = el('div', 'bar-row');
  row.dataset.level = level(r.left);
  const bar = el('div', 'bar');
  const fill = el('span');
  fill.style.width = `${r.left}%`;
  bar.appendChild(fill);
  row.append(el('span', 'label', r.label), el('span', 'pct', `${Math.round(r.left)}%`), bar);
  const rt = resetText(r);
  if (rt) row.appendChild(el('span', 'reset', rt));
  return row;
}

// 系統匣圖示（Windows）：畫一個跟著剩餘量變色的小圓環
function trayIcon(left) {
  const size = 32;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const lw = 5;
  const r = (size - lw) / 2;
  g.lineWidth = lw;
  g.strokeStyle = 'rgba(142,142,147,0.45)';
  g.beginPath(); g.arc(size / 2, size / 2, r, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = { ok: '#30d158', warn: '#ff9f0a', crit: '#ff453a' }[level(left)];
  g.lineCap = 'round';
  g.beginPath();
  g.arc(size / 2, size / 2, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.max(left, 1)) / 100);
  g.stroke();
  return cv.toDataURL('image/png');
}
let lastTrayKey = null;

function render() {
  const rows = limits(state.usage);
  const p = rows.find((r) => r.key === 'five_hour') ?? rows[0];
  const second = rows.find((r) => r.key === 'seven_day' && r !== p) ?? rows.find((r) => r !== p);
  const others = rows.filter((r) => r !== p && r !== second);

  $panel.classList.toggle('collapsed', !!state.collapsed);
  $refresh.classList.toggle('spin', !!state.loading);

  // 標題列的更新時間
  if (state.fetchedAt && !state.needLogin) {
    const old = Date.now() - state.fetchedAt > 10 * 60_000;
    $time.textContent = old ? `⚠ ${hhmm(new Date(state.fetchedAt))} 的數字` : `${hhmm(new Date(state.fetchedAt))} 更新`;
    $time.classList.toggle('stale', old);
  } else {
    $time.textContent = '';
  }

  // 收合時的小圓環
  $mini.replaceChildren();
  if (p) {
    $mini.dataset.level = level(p.left);
    $mini.append(ringSvg(p.left, 18, 3), el('b', '', `${Math.round(p.left)}%`));
  } else {
    delete $mini.dataset.level;
    $mini.append(el('b', '', state.needLogin ? '登入' : '—'));
  }

  if (state.needLogin) {
    const box = el('div', 'empty');
    box.append(el('p', '', '請先登入你的 Claude 帳號，才能讀取用量。'));
    const btn = el('button', '', '登入 Claude');
    btn.addEventListener('click', () => window.usageApi.login());
    box.append(btn);
    $body.replaceChildren(box);
  } else if (p) {
    const ringsBox = el('div', 'rings');
    ringsBox.append(...[p, second].filter(Boolean).map(ringColumn));
    const parts = [ringsBox];
    if (others.length) {
      const bars = el('div', 'bars');
      bars.append(...others.map(barRow));
      parts.push(bars);
    }
    $body.replaceChildren(...parts);
  } else {
    const box = el('div', 'empty');
    box.append(el('p', '', state.usage ? '目前沒有可顯示的用量限制（可能是 API 格式改變）。' : '讀取中…'));
    $body.replaceChildren(box);
  }

  $foot.textContent = state.error ? `⚠ ${state.error}` : '';

  // 系統匣圖示
  const key = p ? `${level(p.left)}:${Math.round(p.left)}` : 'none';
  if (key !== lastTrayKey) {
    lastTrayKey = key;
    window.usageApi.setTrayIcon(p ? trayIcon(p.left) : null);
  }
}

// 讓視窗大小跟著內容走（加上陰影留白）
new ResizeObserver(() => {
  const r = $panel.getBoundingClientRect();
  window.usageApi.resize(r.width + MARGIN * 2, r.height + MARGIN * 2);
}).observe($panel);

$refresh.addEventListener('click', () => window.usageApi.refresh());
document.getElementById('toggle').addEventListener('click', () => window.usageApi.setCollapsed(!state.collapsed));
document.getElementById('close').addEventListener('click', () => window.usageApi.hide());

window.usageApi.onState((s) => { state = s; render(); });
window.usageApi.getState().then((s) => { state = s; render(); });
setInterval(render, 30_000);
