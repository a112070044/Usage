// Claude 用量即時顯示 — 在 claude.ai 頁面上放一個可拖曳的小面板，
// 定時呼叫 claude.ai 網頁本身使用的 /api/organizations/{org}/usage 取得用量。
// 注意：這是 claude.ai 的內部 API，並非官方公開介面，日後可能變動。
(() => {
  if (window.__claudeUsageLoaded) return;
  window.__claudeUsageLoaded = true;

  const POLL_MS = 60_000;          // 一般輪詢間隔
  const AFTER_SEND_MS = [4_000, 20_000]; // 送出訊息後額外刷新的時間點
  const TICK_MS = 30_000;          // 倒數文字更新間隔（不打 API）

  const LABELS = {
    five_hour: '5 小時',
    seven_day: '7 天（全部模型）',
    seven_day_opus: '7 天 Opus',
    seven_day_sonnet: '7 天 Sonnet',
    seven_day_oauth_apps: '7 天 外部應用',
  };
  const ORDER = Object.keys(LABELS);

  let orgId = null;
  let lastData = null;
  let lastFetched = null;
  let lastError = null;
  let inflight = null;

  // ---------- API ----------
  function orgFromCookie() {
    try {
      const m = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch {
      return null;
    }
  }

  async function orgFromApi() {
    const res = await fetch('/api/organizations', { credentials: 'include' });
    if (!res.ok) throw new Error(`取得組織失敗（HTTP ${res.status}）`);
    const orgs = await res.json();
    if (!Array.isArray(orgs) || orgs.length === 0) throw new Error('找不到組織，請確認已登入');
    const chat = orgs.find((o) => Array.isArray(o.capabilities) && o.capabilities.includes('chat'));
    return (chat ?? orgs[0]).uuid;
  }

  async function fetchUsageFor(id) {
    return fetch(`/api/organizations/${encodeURIComponent(id)}/usage`, { credentials: 'include' });
  }

  async function fetchUsage() {
    if (!orgId) orgId = orgFromCookie() ?? (await orgFromApi());
    let res = await fetchUsageFor(orgId);
    if (res.status === 403 || res.status === 404) {
      // cookie 裡的組織可能不對，改用 API 列出的組織重試一次
      const fallback = await orgFromApi();
      if (fallback !== orgId) {
        orgId = fallback;
        res = await fetchUsageFor(orgId);
      }
    }
    if (!res.ok) throw new Error(`取得用量失敗（HTTP ${res.status}）`);
    return res.json();
  }

  function refresh() {
    if (inflight) return inflight;
    inflight = fetchUsage()
      .then((data) => {
        lastData = data;
        lastFetched = new Date();
        lastError = null;
      })
      .catch((err) => {
        lastError = err.message || String(err);
      })
      .finally(() => {
        inflight = null;
        render();
      });
    return inflight;
  }

  // ---------- 資料整理 ----------
  function limits(data) {
    if (!data || typeof data !== 'object') return [];
    const rows = [];
    for (const [key, v] of Object.entries(data)) {
      if (!v || typeof v !== 'object' || typeof v.utilization !== 'number') continue;
      const used = Math.max(0, Math.min(100, v.utilization));
      rows.push({
        key,
        label: LABELS[key] ?? key,
        used,
        left: 100 - used,
        resetsAt: v.resets_at ? new Date(v.resets_at) : null,
      });
    }
    rows.sort((a, b) => rank(a.key) - rank(b.key));
    return rows;
  }
  const rank = (k) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);

  function level(left) {
    if (left <= 10) return 'crit';
    if (left <= 30) return 'warn';
    return 'ok';
  }
  const COLORS = { ok: '#16a34a', warn: '#d97706', crit: '#dc2626' };

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

  // 擴充功能重新載入後舊頁面的 chrome.runtime 會失效，忽略即可
  function notifyBadge(msg) {
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch {}
  }

  // ---------- UI ----------
  const root = document.createElement('div');
  root.id = 'cu-panel';
  root.innerHTML = `
    <div class="cu-head">
      <span class="cu-pill" title="5 小時額度剩餘">…</span>
      <span class="cu-title">Claude 用量</span>
      <button class="cu-btn cu-refresh" title="立即刷新">↻</button>
      <button class="cu-btn cu-toggle" title="收合／展開">–</button>
    </div>
    <div class="cu-body"></div>
    <div class="cu-foot"></div>`;
  const $pill = root.querySelector('.cu-pill');
  const $body = root.querySelector('.cu-body');
  const $foot = root.querySelector('.cu-foot');
  const $toggle = root.querySelector('.cu-toggle');

  function render() {
    const rows = limits(lastData);
    const primary = rows.find((r) => r.key === 'five_hour') ?? rows[0];

    if (primary) {
      const lv = level(primary.left);
      $pill.textContent = `${Math.round(primary.left)}%`;
      $pill.dataset.level = lv;
      notifyBadge({
        type: 'usage',
        text: `${Math.round(primary.left)}`,
        color: COLORS[lv],
        title: rows.map((r) => `${r.label}：剩 ${Math.round(r.left)}%`).join('\n'),
      });
    } else {
      $pill.textContent = lastError ? '!' : '…';
      $pill.dataset.level = lastError ? 'crit' : '';
    }

    $body.replaceChildren(
      ...rows.map((r) => {
        const el = document.createElement('div');
        el.className = 'cu-row';
        el.dataset.level = level(r.left);
        el.innerHTML = `
          <div class="cu-line">
            <span class="cu-label"></span>
            <span class="cu-pct"><b>剩 ${r.left.toFixed(0)}%</b> <small>（已用 ${r.used.toFixed(0)}%）</small></span>
          </div>
          <div class="cu-bar"><div class="cu-fill" style="width:${r.used}%"></div></div>
          <div class="cu-reset"></div>`;
        el.querySelector('.cu-label').textContent = r.label;
        const reset = el.querySelector('.cu-reset');
        if (r.resetsAt) {
          reset.textContent = countdown(r.resetsAt);
          reset.title = `重置時間：${clock(r.resetsAt)}`;
        }
        return el;
      }),
    );
    if (!rows.length && !lastError && lastData) {
      $body.textContent = '目前沒有可顯示的用量限制（可能是 API 格式改變）。';
    }

    const parts = [];
    if (lastError) parts.push(`⚠ ${lastError}`);
    if (lastFetched) parts.push(`更新於 ${lastFetched.toLocaleTimeString('zh-TW', { hour12: false })}`);
    $foot.textContent = parts.join(' · ');
  }

  // 收合狀態與位置記在 chrome.storage
  const store = chrome.storage?.local;
  function save(patch) { store?.set(patch).catch?.(() => {}); }

  function setCollapsed(c) {
    root.classList.toggle('cu-collapsed', c);
    $toggle.textContent = c ? '+' : '–';
  }
  $toggle.addEventListener('click', () => {
    const c = !root.classList.contains('cu-collapsed');
    setCollapsed(c);
    save({ cuCollapsed: c });
  });
  root.querySelector('.cu-refresh').addEventListener('click', () => refresh());

  // 拖曳（抓標題列）
  root.querySelector('.cu-head').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const rect = root.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const move = (ev) => place(ev.clientX - dx, ev.clientY - dy);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const r = root.getBoundingClientRect();
      save({ cuPos: { left: r.left, top: r.top } });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  });
  function place(left, top) {
    const maxL = window.innerWidth - root.offsetWidth - 4;
    const maxT = window.innerHeight - root.offsetHeight - 4;
    root.style.left = `${Math.max(4, Math.min(left, maxL))}px`;
    root.style.top = `${Math.max(4, Math.min(top, maxT))}px`;
    root.style.right = 'auto';
  }

  document.body.appendChild(root);
  store?.get(['cuCollapsed', 'cuPos']).then((s) => {
    setCollapsed(!!s.cuCollapsed);
    if (s.cuPos) place(s.cuPos.left, s.cuPos.top);
  }).catch?.(() => {});

  // ---------- 刷新時機 ----------
  render();
  refresh();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
  setInterval(render, TICK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });

  // 送出訊息後稍等再刷新，讓數字跟著對話即時變動
  let afterSendTimers = [];
  function scheduleAfterSend() {
    afterSendTimers.forEach(clearTimeout);
    afterSendTimers = AFTER_SEND_MS.map((ms) => setTimeout(refresh, ms));
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA')) scheduleAfterSend();
  }, true);
  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element && e.target.closest('button');
    if (!btn) return;
    const label = `${btn.getAttribute('aria-label') ?? ''}`.toLowerCase();
    if (label.includes('send') || label.includes('傳送') || label.includes('送出')) scheduleAfterSend();
  }, true);
})();
