const LABELS = {
  five_hour: '5 小時',
  seven_day: '7 天（全部模型）',
  seven_day_opus: '7 天 Opus',
  seven_day_sonnet: '7 天 Sonnet',
  seven_day_oauth_apps: '7 天 外部應用',
};
const ORDER = Object.keys(LABELS);
const rank = (k) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);

const $panel = document.getElementById('panel');
const $pill = document.querySelector('.pill');
const $body = document.querySelector('.body');
const $foot = document.querySelector('.foot');
const $refresh = document.getElementById('refresh');
const $toggle = document.getElementById('toggle');

let state = {};

function limits(data) {
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data)
    .filter(([, v]) => v && typeof v === 'object' && typeof v.utilization === 'number')
    .map(([key, v]) => {
      const used = Math.max(0, Math.min(100, v.utilization));
      return {
        key,
        label: LABELS[key] ?? key,
        used,
        left: 100 - used,
        resetsAt: v.resets_at ? new Date(v.resets_at) : null,
      };
    })
    .sort((a, b) => rank(a.key) - rank(b.key));
}

function level(left) {
  if (left <= 10) return 'crit';
  if (left <= 30) return 'warn';
  return 'ok';
}

function countdown(date) {
  if (!date || isNaN(date)) return '';
  let ms = date - Date.now();
  if (ms <= 0) return '即將重置';
  const d = Math.floor(ms / 86_400_000); ms -= d * 86_400_000;
  const h = Math.floor(ms / 3_600_000); ms -= h * 3_600_000;
  const m = Math.ceil(ms / 60_000);
  if (d > 0) return `${d} 天 ${h} 小時後重置`;
  if (h > 0) return `${h} 小時 ${m} 分後重置`;
  return `${m} 分後重置`;
}

function clock(date) {
  return date.toLocaleString('zh-TW', {
    month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function renderRow(r) {
  const el = document.createElement('div');
  el.className = 'row';
  el.dataset.level = level(r.left);
  el.innerHTML = `
    <div class="line">
      <span class="label"></span>
      <span class="pct"><b>剩 ${r.left.toFixed(0)}%</b> <small>（已用 ${r.used.toFixed(0)}%）</small></span>
    </div>
    <div class="bar"><div class="fill" style="width:${r.used}%"></div></div>
    <div class="reset"></div>`;
  el.querySelector('.label').textContent = r.label;
  if (r.resetsAt) {
    const reset = el.querySelector('.reset');
    reset.textContent = countdown(r.resetsAt);
    reset.title = `重置時間：${clock(r.resetsAt)}`;
  }
  return el;
}

function render() {
  const rows = limits(state.usage);
  const primary = rows.find((r) => r.key === 'five_hour') ?? rows[0];

  $panel.classList.toggle('collapsed', !!state.collapsed);
  $toggle.textContent = state.collapsed ? '+' : '–';
  $refresh.classList.toggle('spin', !!state.loading);

  if (state.needLogin) {
    $pill.textContent = '登入';
    $pill.dataset.level = '';
    const box = document.createElement('div');
    box.className = 'login';
    box.innerHTML = '<p>請先登入你的 Claude 帳號，才能讀取用量。</p><button>登入 Claude</button>';
    box.querySelector('button').addEventListener('click', () => window.usageApi.login());
    $body.replaceChildren(box);
  } else if (primary) {
    $pill.textContent = `${Math.round(primary.left)}%`;
    $pill.dataset.level = level(primary.left);
    $body.replaceChildren(...rows.map(renderRow));
  } else {
    $pill.textContent = state.error ? '!' : '…';
    $pill.dataset.level = state.error ? 'crit' : '';
    $body.textContent = state.usage ? '目前沒有可顯示的用量限制（可能是 API 格式改變）。' : '讀取中…';
  }

  const parts = [];
  if (state.error) parts.push(`⚠ ${state.error}`);
  if (state.fetchedAt && !state.needLogin) {
    parts.push(`更新於 ${new Date(state.fetchedAt).toLocaleTimeString('zh-TW', { hour12: false })}`);
  }
  $foot.textContent = parts.join(' · ');
}

// 讓視窗大小跟著內容走
new ResizeObserver(() => {
  const r = $panel.getBoundingClientRect();
  window.usageApi.resize(r.width, r.height);
}).observe($panel);

$refresh.addEventListener('click', () => window.usageApi.refresh());
$toggle.addEventListener('click', () => window.usageApi.setCollapsed(!state.collapsed));
document.getElementById('close').addEventListener('click', () => window.usageApi.hide());

window.usageApi.onState((s) => { state = s; render(); });
window.usageApi.getState().then((s) => { state = s; render(); });
setInterval(render, 30_000);
