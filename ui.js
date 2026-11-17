/* ui.js — интерфейс приложения */

const App = {
  data: null,
  tab: 'accounts',
  month: null,
  horizon: 6,
  syncStatus: ''
};

const STORE_KEY = 'cash.data.v1';
const APP_VERSION = '0.9';

/* ---------- хранилище ---------- */
function loadData() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      App.data = Object.assign(emptyData(), d);
      App.data.settings = Object.assign({ currency: '₽', horizon: 6, tg: {}, yd: {} }, d.settings || {});
      return;
    }
  } catch (e) { console.warn('load failed', e); }
  App.data = emptyData();
}
function saveData() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(App.data)); } catch (e) { toast('Не удалось сохранить: ' + e.message); }
}

/* ---------- фото чеков: локальный кэш в IndexedDB ---------- */
const PhotoStore = {
  _db: null,
  open() {
    return new Promise((res, rej) => {
      if (this._db) return res(this._db);
      const rq = indexedDB.open('cash.photos', 1);
      rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains('blobs')) rq.result.createObjectStore('blobs'); };
      rq.onsuccess = () => { this._db = rq.result; res(this._db); };
      rq.onerror = () => rej(rq.error);
    });
  },
  async _run(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('blobs', mode);
      const rq = fn(t.objectStore('blobs'));
      t.oncomplete = () => res(rq && rq.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  put(name, blob) { return this._run('readwrite', s => s.put(blob, name)); },
  get(name) { return this._run('readonly', s => s.get(name)); },
  del(name) { return this._run('readwrite', s => s.delete(name)); }
};

/* сжимает фото до читаемого размера: длинная сторона ≤ maxSide, JPEG */
function shrinkImage(file, maxSide, quality) {
  maxSide = maxSide || 1600;
  quality = quality || 0.82;
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k));
        const h = Math.max(1, Math.round(img.naturalHeight * k));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        cv.toBlob(b => {
          URL.revokeObjectURL(url);
          b ? res(b) : rej(new Error('не удалось сжать'));
        }, 'image/jpeg', quality);
      } catch (e) { URL.revokeObjectURL(url); rej(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('это не картинка')); };
    img.src = url;
  });
}

/* ссылка на фото: сначала локальный кэш, потом Диск (и кэшируем) */
async function photoSrc(name) {
  const blob = await PhotoStore.get(name).catch(() => null);
  if (blob) return URL.createObjectURL(blob);
  const token = ((App.data.settings.yd || {}).token || '').trim();
  if (!token) return null;
  try {
    const href = await ydPhotoHref(token, name);
    try {
      const b = await ydGetHref(href, token, 'blob');
      await PhotoStore.put(name, b).catch(() => {});
      return URL.createObjectURL(b);
    } catch (e) { return href; }
  } catch (e) { return null; }
}

function openPhotoViewer(src) {
  let v = document.getElementById('photoViewer');
  if (!v) {
    v = document.createElement('div');
    v.id = 'photoViewer';
    v.className = 'viewer hidden';
    v.innerHTML = '<img alt="чек"><button class="btn" id="vClose">Закрыть</button>';
    document.body.appendChild(v);
    v.onclick = e => { if (e.target === v || e.target.id === 'vClose') v.classList.add('hidden'); };
  }
  const vi = v.querySelector('img');
  vi.referrerPolicy = 'no-referrer';
  vi.src = src;
  v.classList.remove('hidden');
}

/* отчёт пошаговой проверки Диска */
function showDoctor(text) {
  openSheet(`
    <h3>Проверка Яндекс.Диска</h3>
    <pre class="doctor">${esc(text)}</pre>
    <div class="actions">
      <button class="btn" id="dCopy">Скопировать</button>
      <button class="btn soft" id="dClose">Закрыть</button>
    </div>
    <div class="hint">Если есть строки с ✘ — пришли этот текст целиком.</div>
  `, sheet => {
    $('#dClose', sheet).onclick = closeSheet;
    $('#dCopy', sheet).onclick = async () => {
      try { await navigator.clipboard.writeText(text); toast('Скопировано'); }
      catch (e) {
        const r = document.createRange();
        r.selectNodeContents($('.doctor', sheet));
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
        toast('Выделено — скопируй вручную');
      }
    };
  });
}

/* ---------- утилиты ---------- */
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

const ICON_SVG = {
  cash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/></svg>',
  card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/><path d="M6 15h4"/></svg>',
  deposit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 10l9-6 9 6"/><path d="M5 10v9h14v-9"/><path d="M9 19v-5h6v5"/></svg>',
  inc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>',
  exp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg>',
  transfer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>'
};

function accTypeName(t) { return t === 'card' ? 'Карта' : t === 'deposit' ? 'Вклад' : 'Наличные'; }
function catName(id) {
  const c = App.data.categories.find(x => x.id === id);
  if (!c) return 'Без категории';
  if (c.parentId) {
    const p = App.data.categories.find(x => x.id === c.parentId);
    if (p) return p.name + ' › ' + c.name;
  }
  return c.name;
}

/* опции для селекта категорий: корневые + подкатегории с отступом */
function catOptionsHtml(list, sel) {
  const roots = list.filter(c => !c.parentId);
  const byParent = {};
  list.filter(c => c.parentId).forEach(c => {
    (byParent[c.parentId] = byParent[c.parentId] || []).push(c);
  });
  let html = '';
  const opt = (c, prefix) => {
    html += `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${prefix}${esc(c.name)}</option>`;
  };
  for (const r of roots) {
    opt(r, '');
    for (const k of (byParent[r.id] || [])) opt(k, '— ');
    delete byParent[r.id];
  }
  Object.keys(byParent).forEach(pid => byParent[pid].forEach(k => opt(k, '— ')));
  return html;
}
function accName(id) { const a = App.data.accounts.find(x => x.id === id); return a ? a.name : '—'; }

function repeatText(p) {
  if (!p.repeat || !p.repeat.freq) return 'разово, ' + D.ru(p.startDate || '');
  const n = Math.max(1, p.repeat.interval || 1);
  const base = p.repeat.freq === 'day' ? (n === 1 ? 'каждый день' : 'каждые ' + n + ' дн.')
    : p.repeat.freq === 'week' ? (n === 1 ? 'каждую неделю' : 'каждые ' + n + ' нед.')
    : (n === 1 ? 'каждый месяц' : 'каждые ' + n + ' мес.');
  const dm = D.parse(p.startDate || D.today()).getDate();
  const dayPart = p.repeat.freq === 'month' ? ', ' + dm + '-го' : '';
  const endPart = p.endDate ? ', до ' + D.ru(p.endDate) : '';
  return base + dayPart + endPart;
}

/* ---------- модальные окна ---------- */
function openSheet(html, onMount) {
  const m = $('#modal');
  m.innerHTML = '<div class="sheet">' + html + '</div>';
  m.classList.remove('hidden');
  m.onclick = e => { if (e.target === m) closeSheet(); };
  if (onMount) onMount($('.sheet', m));
}
function closeSheet() { const m = $('#modal'); m.classList.add('hidden'); m.innerHTML = ''; }

/* ---------- отрисовка ---------- */
function render() {
  const total = totalBalance(App.data);
  const tv = $('#totalValue');
  tv.textContent = Money.fmt(total);
  tv.classList.toggle('neg', total < 0);
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === App.tab));

  const view = $('#view');
  if (App.tab === 'accounts') view.innerHTML = viewAccounts();
  else if (App.tab === 'transactions') view.innerHTML = viewTransactions();
  else if (App.tab === 'plans') view.innerHTML = viewPlans();
  else if (App.tab === 'forecast') view.innerHTML = viewForecast();
  else view.innerHTML = viewSettings();
  bindView();
}

function viewAccounts() {
  const accs = App.data.accounts.filter(a => !a.closed).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  let rows = accs.map((a, i) => {
    const bal = accountBalance(App.data, a.id);
    return `<div class="row" data-edit-acc="${a.id}">
      <div class="ico">${ICON_SVG[a.type] || ICON_SVG.cash}</div>
      <div class="grow">
        <div class="title">${esc(a.name)}${a.noTotal ? ' <span class="pill">не в итоге</span>' : ''}</div>
        <div class="sub">${accTypeName(a.type)}</div>
      </div>
      <div class="amount ${bal < 0 ? 'neg' : ''}">${Money.fmt(bal)}</div>
      <div class="move">
        <button class="btn soft sm" data-up="${a.id}" ${i === 0 ? 'disabled' : ''} aria-label="выше">↑</button>
        <button class="btn soft sm" data-down="${a.id}" ${i === accs.length - 1 ? 'disabled' : ''} aria-label="ниже">↓</button>
      </div>
    </div>`;
  }).join('');
  if (!accs.length) rows = '<div class="empty">Пока нет счетов.<br>Добавь первый — наличные, карту или вклад.</div>';
  return `
    <div class="card"><h2>Мои счета</h2>${rows || '<div class="empty">Пусто</div>'}</div>
    <div class="fab-row">
      <button class="btn block" data-act="add-acc">+ Добавить счёт</button>
    </div>
    <div class="hint">Нажми на счёт, чтобы изменить или удалить; стрелками ↑↓ меняется порядок.
      В свойствах счёта можно исключить его из общего баланса.</div>`;
}

/* сдвиг счёта вверх/вниз с перенумерацией */
function moveAccount(id, dir) {
  const list = App.data.accounts.filter(a => !a.closed).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const i = list.findIndex(a => a.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const [moved] = list.splice(i, 1);
  list.splice(j, 0, moved);
  const now = Date.now();
  list.forEach((a, idx) => { a.sort = idx; a.updatedAt = now; });
  saveData(); render();
}

function viewTransactions() {
  if (!App.month) App.month = D.today().slice(0, 7);
  const [y, m] = App.month.split('-').map(Number);
  const start = App.month + '-01';
  const lastDay = new Date(y, m, 0).getDate();
  const end = App.month + '-' + String(lastDay).padStart(2, '0');
  const list = App.data.transactions
    .filter(t => !t.deleted && t.date >= start && t.date <= end)
    .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));

  const byDate = {};
  for (const t of list) { (byDate[t.date] = byDate[t.date] || []).push(t); }

  let html = '';
  for (const d of Object.keys(byDate).sort().reverse()) {
    const items = byDate[d].map(t => {
      const isInc = t.amount > 0;
      const isTr = !!t.transferAccountId;
      const sp = isTr ? null : txSplits(t);
      const icon = isTr ? ICON_SVG.transfer : isInc ? ICON_SVG.inc : ICON_SVG.exp;
      const cls = isTr ? '' : isInc ? 'inc' : 'exp';
      const primary = sp ? catName(sp[0].categoryId) : catName(t.categoryId);
      const titleCat = sp ? primary + ' +' + (sp.length - 1) : primary;
      const sub = (isTr ? '→ ' + accName(t.transferAccountId)
        : (sp ? sp.map(x => catName(x.categoryId)).join(' + ') : primary) + (t.payee ? ' · ' + t.payee : ''))
        + (t.photo ? ' · фото' : '');
      return `<div class="row" data-edit-tx="${t.id}">
        <div class="ico ${cls}">${icon}</div>
        <div class="grow"><div class="title">${esc(isTr ? 'Перевод' : (t.payee || titleCat))}</div>
          <div class="sub">${esc(sub)}</div></div>
        <div class="amount ${t.amount < 0 ? 'neg' : 'pos'}">${Money.fmt(t.amount, true)}</div>
      </div>`;
    }).join('');
    const daySum = byDate[d].reduce((s, t) => s + t.amount, 0);
    html += `<div class="card"><h2>${D.ru(d)} <span style="float:right">${Money.fmt(daySum, true)}</span></h2>${items}</div>`;
  }
  if (!list.length) html = '<div class="card"><div class="empty">За этот месяц операций нет.</div></div>';

  return `
    <div class="card" style="padding:10px 12px">
      <div class="row">
        <button class="btn soft sm" data-act="month-prev">‹</button>
        <div class="grow right" style="font-weight:600">${D.monthName(start)}</div>
        <button class="btn soft sm" data-act="month-next">›</button>
      </div>
    </div>
    <div class="fab-row">
      <button class="btn" data-act="add-exp" style="flex:1">− Расход</button>
      <button class="btn ghost" data-act="add-inc" style="flex:1">+ Доход</button>
      <button class="btn soft" data-act="add-tr" style="flex:0 0 auto">⇄</button>
    </div>
    ${html}`;
}

function viewPlans() {
  const plans = App.data.plans.filter(p => !p.deleted).sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  let rows = plans.map(p => {
    const cls = p.amount > 0 ? 'inc' : 'exp';
    return `<div class="row" data-edit-plan="${p.id}">
      <div class="ico ${cls}">${ICON_SVG.plan}</div>
      <div class="grow">
        <div class="title">${esc(p.payee || catName(p.categoryId))}</div>
        <div class="sub">${esc(repeatText(p))}${p.accountId ? ' · ' + esc(accName(p.accountId)) : ''}</div>
      </div>
      <div class="amount ${p.amount < 0 ? 'neg' : 'pos'}">${Money.fmt(p.amount, true)}</div>
    </div>`;
  }).join('');
  if (!plans.length) rows = '<div class="empty">Плановых операций нет.<br>Добавь зарплату, платёж по кредиту, аренду — и увидишь прогноз баланса.</div>';
  return `
    <div class="card"><h2>Плановые операции</h2>${rows}</div>
    <div class="fab-row"><button class="btn block" data-act="add-plan">+ Плановая операция</button></div>
    <div class="hint">Планы участвуют только в прогнозе и не меняют текущий баланс.</div>`;
}

function chartSVG(fc) {
  const pts = fc.points;
  if (!pts.length) return '';
  const w = 720, h = 250, padT = 22, padB = 26, padL = 8, padR = 8;
  const ys = pts.map(p => p.balance);
  let maxV = Math.max.apply(null, ys.concat([0]));
  let minV = Math.min.apply(null, ys.concat([0]));
  if (maxV === minV) { maxV += 1000; minV -= 1000; }
  const span = maxV - minV;
  const yOf = v => padT + (maxV - v) / span * (h - padT - padB);
  const xOf = i => padL + (pts.length === 1 ? 0 : i / (pts.length - 1)) * (w - padL - padR);
  const zeroY = yOf(0);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + xOf(i).toFixed(1) + ' ' + yOf(p.balance).toFixed(1)).join(' ');
  const area = `M ${xOf(0).toFixed(1)} ${zeroY.toFixed(1)} ` + pts.map((p, i) => 'L ' + xOf(i).toFixed(1) + ' ' + yOf(p.balance).toFixed(1)).join(' ') + ` L ${xOf(pts.length - 1).toFixed(1)} ${zeroY.toFixed(1)} Z`;

  let marks = '';
  if (fc.zeroDate) {
    const i = pts.findIndex(p => p.date === fc.zeroDate);
    if (i >= 0) {
      const x = xOf(i);
      marks += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${h - padB}" stroke="#2f6fed" stroke-width="1.4" stroke-dasharray="4 4" opacity=".55"/>`;
      marks += `<circle cx="${x}" cy="${zeroY}" r="4.5" fill="#2f6fed"/>`;
      const label = 'в плюс ' + D.ruShort(fc.zeroDate);
      const anchor = x > w * 0.72 ? 'end' : 'start';
      const lx = x > w * 0.72 ? x - 8 : x + 8;
      marks += `<text x="${lx}" y="${padT + 11}" text-anchor="${anchor}" font-size="12" fill="#2f6fed" font-weight="600">${label}</text>`;
    }
  }
  if (fc.min < 0) {
    const i = pts.findIndex(p => p.date === fc.minDate);
    if (i >= 0) marks += `<circle cx="${xOf(i)}" cy="${yOf(fc.min)}" r="4" fill="#e5484d"/>`;
  }

  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Прогноз баланса">
    <rect x="0" y="0" width="${w}" height="${zeroY}" fill="#eefaf4"/>
    <rect x="0" y="${zeroY}" width="${w}" height="${h - zeroY}" fill="#fdf0f0"/>
    <path d="${area}" fill="rgba(47,111,237,.13)"/>
    <line x1="0" y1="${zeroY}" x2="${w}" y2="${zeroY}" stroke="#9aa4b2" stroke-width="1" stroke-dasharray="3 4"/>
    <text x="6" y="${zeroY - 5}" font-size="11" fill="#6b7280">0</text>
    <path d="${line}" fill="none" stroke="#2f6fed" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
    ${marks}
    <text x="${padL}" y="${h - 8}" font-size="11" fill="#6b7280">${D.ruShort(pts[0].date)}</text>
    <text x="${w - padR}" y="${h - 8}" text-anchor="end" font-size="11" fill="#6b7280">${D.ruShort(pts[pts.length - 1].date)}</text>
  </svg>`;
}

function viewForecast() {
  const fc = forecast(App.data, App.horizon);
  const seg = [3, 6, 12].map(n => `<button data-h="${n}" class="${n === App.horizon ? 'on' : ''}">${n} мес</button>`).join('');
  let verdict, zeroLabel;
  if (fc.zeroDate) {
    verdict = `<span class="pos">Выйдешь в плюс ${D.ru(fc.zeroDate)}</span>`;
    zeroLabel = `<span class="pos">${D.ru(fc.zeroDate)}</span>`;
  } else if (fc.min >= 0) {
    verdict = '<span class="pos">Баланс всё время положительный</span>';
    zeroLabel = '<span class="pos">уже в плюсе</span>';
  } else {
    verdict = '<span class="neg">В минусе весь период — планов не хватает</span>';
    zeroLabel = '<span class="neg">не выйдет</span>';
  }

  return `
    <div class="card" style="padding:8px"><div class="seg">${seg}</div></div>
    <div class="stats">
      <div class="stat"><div class="k">Сейчас</div><div class="v ${fc.startBalance < 0 ? 'neg' : ''}">${Money.fmt(fc.startBalance)}</div></div>
      <div class="stat"><div class="k">Через ${App.horizon} мес</div><div class="v ${fc.endBalance < 0 ? 'neg' : ''}">${Money.fmt(fc.endBalance)}</div></div>
      <div class="stat"><div class="k">Минимум</div><div class="v ${fc.min < 0 ? 'neg' : ''}">${Money.fmt(fc.min)}</div><div class="tiny muted">${D.ru(fc.minDate)}</div></div>
      <div class="stat"><div class="k">Выход в плюс</div><div class="v" style="font-size:15px">${zeroLabel}</div></div>
    </div>
    <div class="chartwrap">${chartSVG(fc)}</div>
    <div class="hint">${verdict}. Прогноз строится по плановым операциям: фактические траты в него не входят, только то, что запланировано.</div>`;
}

function viewSettings() {
  const s = App.data.settings;
  return `
    <div class="card">
      <h2>Данные</h2>
      <div class="row"><div class="grow"><div class="title">Резервная копия</div><div class="sub">Файл JSON со всеми счетами, операциями и планами</div></div></div>
      <div class="fab-row" style="margin:12px 0 0">
        <button class="btn ghost" data-act="export">Скачать</button>
        <button class="btn soft" data-act="import">Загрузить</button>
      </div>
      <input type="file" id="importFile" accept=".json,application/json" style="display:none">
      <div class="fab-row" style="margin:10px 0 0">
        <button class="btn danger" data-act="wipe-local">Очистить базу</button>
        <button class="btn danger" data-act="wipe-cloud">Очистить бэкап</button>
      </div>
      <div class="hint">«Очистить базу» удаляет счета, операции и категории на этом устройстве.
        «Очистить бэкап» удаляет файл базы на Яндекс.Диске — на других устройствах данные останутся только локально.</div>
    </div>

    <div class="card">
      <h2>Яндекс.Диск</h2>
      ${(s.yd || {}).token ? `
        <div class="row">
          <div class="ico inc">${ICON_SVG.inc}</div>
          <div class="grow"><div class="title">Подключён${(s.yd || {}).login ? ' · ' + esc(s.yd.login) : ''}</div>
            <div class="sub">База синхронизируется в app:/Cash/cash-data.json</div></div>
        </div>
        <div class="fab-row" style="margin:12px 0 0">
          <button class="btn" data-act="yd-sync" style="flex:1">Синхронизировать</button>
          <button class="btn danger" data-act="yd-logout">Отключить</button>
        </div>
        <button class="btn ghost block" data-act="yd-doctor" style="margin-top:8px">Проверить Диск</button>`
      : `
        <div class="sub">Войди через Яндекс ID — приложение получит доступ только к своей папке на Диске.</div>
        <div class="fab-row" style="margin:12px 0 0"><button class="btn block" data-act="yd-login">Войти через Яндекс</button></div>
        <div class="hint"><a href="#" data-act="yd-manual" style="color:inherit">или вставить токен вручную</a></div>`}
      <div class="hint" id="ydStatus">${esc(App.syncStatus || '')}</div>
    </div>

    <div class="card">
      <h2>Telegram-бот</h2>
      <div class="field"><label>Токен бота</label><input id="tgToken" type="password" placeholder="123456:ABC-DEF..." value="${esc((s.tg || {}).token || '')}"></div>
      <div class="field"><label>Chat ID</label><input id="tgChat" placeholder="например 123456789" value="${esc((s.tg || {}).chatId || '')}"></div>
      <button class="btn block" data-act="tg-send">Отправить бэкап в Telegram</button>
    </div>

    <div class="card">
      <h2>О приложении</h2>
      <div class="sub">Cash — свой учёт финансов с прогнозом денежного потока. Данные хранятся только на устройстве, пока ты сам не отправишь их в облако.</div>
      <div class="hint">Версия ${APP_VERSION} · ${esc(navigator.userAgent.includes('Android') ? 'Android' : 'ПК')}</div>
    </div>`;
}

/* ---------- обработчики ---------- */
function bindView() {
  const view = $('#view');
  $$('[data-act]', view).forEach(b => b.onclick = () => act(b.dataset.act));
  $$('[data-edit-acc]', view).forEach(r => r.onclick = () => editAccount(r.dataset.editAcc));
  $$('[data-up]', view).forEach(b => b.onclick = e => { e.stopPropagation(); moveAccount(b.dataset.up, -1); });
  $$('[data-down]', view).forEach(b => b.onclick = e => { e.stopPropagation(); moveAccount(b.dataset.down, 1); });
  $$('[data-edit-tx]', view).forEach(r => r.onclick = () => editTransaction(r.dataset.editTx));
  $$('[data-edit-plan]', view).forEach(r => r.onclick = () => editPlan(r.dataset.editPlan));
  $$('[data-h]', view).forEach(b => b.onclick = () => { App.horizon = +b.dataset.h; render(); });
}

function act(name) {
  if (name === 'add-acc') editAccount(null);
  else if (name === 'add-exp') editTransaction(null, 'exp');
  else if (name === 'add-inc') editTransaction(null, 'inc');
  else if (name === 'add-tr') editTransaction(null, 'tr');
  else if (name === 'add-plan') editPlan(null);
  else if (name === 'month-prev') { App.month = shiftMonth(App.month, -1); render(); }
  else if (name === 'month-next') { App.month = shiftMonth(App.month, 1); render(); }
  else if (name === 'export') exportJSON();
  else if (name === 'import') $('#importFile').click();
  else if (name === 'wipe-local') wipeLocal();
  else if (name === 'wipe-cloud') wipeCloud();
  else if (name === 'yd-sync') yandexSync();
  else if (name === 'yd-doctor') ydDoctor();
  else if (name === 'yd-login') YA.login();
  else if (name === 'yd-logout') {
    if (!confirm('Отключить Яндекс.Диск? Файл на Диске останется.')) return;
    App.data.settings.yd = {};
    saveData(); render(); toast('Отключено');
  }
  else if (name === 'yd-manual') manualYandexToken();
  else if (name === 'tg-send') telegramSend();
}
function shiftMonth(m, n) {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y, mm - 1 + n, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/* ---------- счёт ---------- */
function editAccount(id) {
  const a = id ? App.data.accounts.find(x => x.id === id) : null;
  openSheet(`
    <h3>${a ? 'Счёт' : 'Новый счёт'}</h3>
    <div class="field"><label>Название</label><input id="fName" value="${esc(a ? a.name : '')}" placeholder="Например, Тинькофф"></div>
    <div class="two">
      <div class="field"><label>Тип</label>
        <select id="fType">
          <option value="cash" ${a && a.type === 'cash' ? 'selected' : ''}>Наличные</option>
          <option value="card" ${a && a.type === 'card' ? 'selected' : ''}>Карта</option>
          <option value="deposit" ${a && a.type === 'deposit' ? 'selected' : ''}>Вклад</option>
        </select>
      </div>
      <div class="field"><label>Начальный остаток</label><input id="fOpen" inputmode="decimal" value="${a ? (a.opening / 100).toFixed(2) : '0.00'}"></div>
    </div>
    <label class="check"><input type="checkbox" id="fNoTotal" ${a && a.noTotal ? 'checked' : ''}>
      <span>Не учитывать в общем балансе</span></label>
    <div class="actions">
      <button class="btn" id="fSave">Сохранить</button>
      ${a ? '<button class="btn danger" id="fDel">Удалить</button>' : ''}
    </div>
  `, sheet => {
    $('#fSave', sheet).onclick = () => {
      const name = $('#fName', sheet).value.trim() || 'Счёт';
      const type = $('#fType', sheet).value;
      const opening = Money.toMinor($('#fOpen', sheet).value);
      const noTotal = $('#fNoTotal', sheet).checked;
      if (a) { Object.assign(a, { name, type, opening, noTotal, updatedAt: Date.now() }); }
      else App.data.accounts.push({ id: uid(), name, type, opening, noTotal, sort: App.data.accounts.length, closed: false, updatedAt: Date.now() });
      saveData(); closeSheet(); render();
    };
    if (a) $('#fDel', sheet).onclick = () => {
      if (!confirm('Удалить счёт «' + a.name + '»? Операции по нему останутся в базе.')) return;
      App.data.transactions.forEach(t => { if (t.accountId === a.id) t.deleted = true; });
      App.data.plans.forEach(p => { if (p.accountId === a.id) p.deleted = true; });
      a.deleted = true; a.closed = true;
      saveData(); closeSheet(); render();
    };
  });
}

/* ---------- операция ---------- */
function editTransaction(id, kind) {
  const t = id ? App.data.transactions.find(x => x.id === id) : null;
  const accs = App.data.accounts.filter(a => !a.closed);
  if (!accs.length) { toast('Сначала добавь счёт'); return; }
  const isTr = t ? !!t.transferAccountId : kind === 'tr';
  const isInc = t ? t.amount > 0 : kind === 'inc';
  const amountVal = t ? Math.abs(t.amount / 100).toFixed(2) : '';
  const oldSplits = t ? txSplits(t) : null;

  const accOpts = sel => accs.map(a => `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const cats0 = App.data.categories.filter(c => c.type === (isInc ? 'income' : 'expense'));

  openSheet(`
    <h3>${t ? 'Операция' : isTr ? 'Перевод' : isInc ? 'Доход' : 'Расход'}</h3>
    <div class="seg" id="segKind">
      <button data-k="exp" class="${!isInc && !isTr ? 'on' : ''}">Расход</button>
      <button data-k="inc" class="${isInc && !isTr ? 'on' : ''}">Доход</button>
      <button data-k="tr" class="${isTr ? 'on' : ''}">Перевод</button>
    </div>
    <div class="field" style="margin-top:12px">
      <label>Сумма</label>
      <div class="amrow">
        <input id="fAmount" inputmode="decimal" placeholder="0.00" value="${amountVal}">
        <button class="btn soft sm" id="fSplitOn" type="button" style="${isTr ? 'display:none' : ''}">Сплит</button>
        <span class="leftval" id="fLeft" style="display:none"></span>
      </div>
    </div>
    <div class="field"><label>Дата</label><input id="fDate" type="date" value="${t ? t.date : D.today()}"></div>
    <div class="field" id="accWrap"><label>${isTr ? 'Со счёта' : 'Счёт'}</label><select id="fAcc">${accOpts(t ? t.accountId : accs[0].id)}</select></div>
    <div class="field" id="acc2Wrap" style="${isTr ? '' : 'display:none'}"><label>На счёт</label><select id="fAcc2">${accOpts(t && t.transferAccountId ? t.transferAccountId : (accs[1] || accs[0]).id)}</select></div>
    <div class="field" id="catWrap" style="${isTr || oldSplits ? 'display:none' : ''}">
      <label>Категория</label>
      <div class="catrow">
        <select id="fCat">${catOptionsHtml(cats0, t ? txCategoryId(t) : (cats0[0] && cats0[0].id))}</select>
        <button class="btn soft sm" id="catAddBtn" type="button">+</button>
      </div>
    </div>
    <div class="field" id="splitWrap" style="${oldSplits && !isTr ? '' : 'display:none'}">
      <label>Разбивка по категориям</label>
      <div id="splitRows"></div>
      <button class="btn soft sm block" id="fSplitAdd" type="button" style="margin-top:8px">+ строка</button>
      <button class="btn ghost sm block" id="fSplitOff" type="button" style="margin-top:6px">Убрать разбивку</button>
      <div class="hint" id="splitInfo"></div>
    </div>
    <div class="field" id="catNew" style="display:none">
      <label>Новая категория</label>
      <input id="cnName" placeholder="Например, Кафе">
      <div class="two" style="margin-top:8px">
        <select id="cnParent"></select>
        <button class="btn sm" id="cnAdd" type="button">Создать</button>
      </div>
      <div class="hint">Выбери родителя — получится подкатегория.</div>
    </div>
    <div class="field"><label>Контрагент / название</label><input id="fPayee" value="${esc(t ? (t.payee || '') : '')}" placeholder="Пятёрочка, зарплата…"></div>
    <div class="field"><label>Заметка</label><input id="fNote" value="${esc(t ? (t.note || '') : '')}"></div>
    <div class="field" id="photoField" style="${isTr ? 'display:none' : ''}">
      <label>Фото чека</label>
      <div id="photoBox"></div>
      <input type="file" id="photoFile" accept="image/*" style="display:none">
      <input type="file" id="photoCam" accept="image/*" capture="environment" style="display:none">
      <div class="two" style="margin-top:8px">
        <button class="btn soft sm" id="photoAdd" type="button">Снять фото</button>
        <button class="btn soft sm" id="photoGal" type="button">Из галереи</button>
      </div>
      <button class="btn ghost sm block" id="photoDel" type="button" style="margin-top:8px">Убрать фото</button>
      <div class="hint" id="photoHint"></div>
    </div>
    <div class="actions">
      <button class="btn" id="fSave">Сохранить</button>
      ${t ? '<button class="btn danger" id="fDel">Удалить</button>' : ''}
    </div>
  `, sheet => {
    const state = { kind: isTr ? 'tr' : isInc ? 'inc' : 'exp', split: !!oldSplits && !isTr,
      photo: t ? (t.photo || null) : null, photoBlob: null, photoPending: !!(t && t.photoPending),
      catTarget: null };

    const catList = () => App.data.categories.filter(c => c.type === (state.kind === 'inc' ? 'income' : 'expense'));

    const recalcSplit = () => {
      const rows = $$('.srow', sheet);
      let sum = 0;
      rows.forEach(r => { sum += Math.abs(Money.toMinor($('.f-split-amt', r).value)); });
      const total = Math.abs(Money.toMinor($('#fAmount', sheet).value));
      const left = total - sum;

      const leftEl = $('#fLeft', sheet);
      if (leftEl) {
        if (state.split) {
          leftEl.style.display = '';
          leftEl.textContent = left === 0 ? 'распределено' : left > 0 ? 'осталось ' + Money.fmt(left) : 'перебор ' + Money.fmt(-left);
          leftEl.className = 'leftval' + (left < 0 ? ' neg' : left === 0 ? ' pos' : '');
        } else {
          leftEl.style.display = 'none';
        }
      }

      const info = $('#splitInfo', sheet);
      if (info) {
        if (!rows.length) info.textContent = 'Добавь хотя бы две строки';
        else if (left > 0) info.textContent = 'Осталось распределить: ' + Money.fmt(left);
        else if (left < 0) info.textContent = 'Перебор на ' + Money.fmt(-left) + ' — столько распределить нельзя';
        else info.textContent = 'Распределено полностью';
        info.style.color = left < 0 ? 'var(--neg)' : '';
      }

      rows.forEach(r => $('.f-split-amt', r).classList.toggle('over', left < 0));

      const save = $('#fSave', sheet);
      if (save) save.disabled = state.split && (left !== 0 || rows.length < 2);
    };

    const fillParents = () => {
      const list = catList().filter(c => !c.parentId);
      const sel = $('#cnParent', sheet);
      const cur = sel.value;
      sel.innerHTML = '<option value="">— корневая —</option>' +
        list.map(c => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    };

    const openCatNew = target => {
      state.catTarget = target || null;
      $('#catNew', sheet).style.display = '';
      $('#cnName', sheet).value = '';
      fillParents();
      $('#cnName', sheet).focus();
      $('#catNew', sheet).scrollIntoView({ block: 'nearest' });
    };

    const addSplitRow = (catId, val) => {
      const list = catList();
      const sel = catId || (list[0] ? list[0].id : '');
      const el = document.createElement('div');
      el.className = 'srow';
      el.innerHTML = `<select class="f-split-cat">${catOptionsHtml(list, sel)}</select>
        <input class="f-split-amt" inputmode="decimal" placeholder="0.00" value="${val || ''}">
        <button class="btn soft sm" data-add type="button">+</button>
        <button class="btn danger sm" data-del type="button">×</button>`;
      $('[data-add]', el).onclick = () => openCatNew($('.f-split-cat', el));
      $('[data-del]', el).onclick = () => {
        if ($$('.srow', sheet).length <= 2) { toast('Минимум две категории'); return; }
        el.remove(); recalcSplit();
      };
      $('.f-split-amt', el).addEventListener('input', recalcSplit);
      $('#splitRows', sheet).appendChild(el);
    };

    const setSplit = on => {
      state.split = !!on && state.kind !== 'tr';
      $('#splitWrap', sheet).style.display = state.split ? '' : 'none';
      $('#catWrap', sheet).style.display = (state.split || state.kind === 'tr') ? 'none' : '';
      const btn = $('#fSplitOn', sheet);
      btn.classList.toggle('btn', state.split);
      btn.classList.toggle('soft', !state.split);
      btn.textContent = state.split ? 'Сплит ✓' : 'Сплит';
      $('#splitRows', sheet).innerHTML = '';
      if (!state.split) { $('#catNew', sheet).style.display = 'none'; recalcSplit(); return; }
      if (oldSplits && oldSplits.length) {
        oldSplits.forEach(s => addSplitRow(s.categoryId, (Math.abs(s.amount) / 100).toFixed(2)));
      } else {
        addSplitRow($('#fCat', sheet).value, '');
        addSplitRow('', '');
      }
      recalcSplit();
    };

    if (oldSplits && !isTr) setSplit(true);
    $('#fSplitOn', sheet).onclick = () => setSplit(!state.split);
    $('#fSplitOff', sheet).onclick = () => setSplit(false);
    $('#fSplitAdd', sheet).onclick = () => { addSplitRow('', ''); recalcSplit(); };
    $('#fAmount', sheet).addEventListener('input', () => { recalcSplit(); });

    const refreshCats = () => {
      const list = catList();
      const main = $('#fCat', sheet);
      if (main) main.innerHTML = catOptionsHtml(list, main.value);
      $$('.srow', sheet).forEach(r => {
        const sel = $('.f-split-cat', r);
        const cur = sel.value;
        sel.innerHTML = catOptionsHtml(list, cur);
      });
      const np = $('#cnParent', sheet);
      if (np && $('#catNew', sheet).style.display !== 'none') fillParents();
    };

    $('#catAddBtn', sheet).onclick = () => openCatNew($('#fCat', sheet));
    $('#cnAdd', sheet).onclick = () => {
      const name = $('#cnName', sheet).value.trim();
      if (!name) { toast('Введите название'); return; }
      const parentId = $('#cnParent', sheet).value || null;
      const cat = {
        id: 'cat' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        name, type: state.kind === 'inc' ? 'income' : 'expense',
        parentId, updatedAt: Date.now()
      };
      App.data.categories.push(cat);
      saveData();
      refreshCats();
      if (state.catTarget && state.catTarget.isConnected) state.catTarget.value = cat.id;
      $('#catNew', sheet).style.display = 'none';
      recalcSplit();
      toast('Категория «' + name + '» создана');
    };

    const paintPhoto = async () => {
      const box = $('#photoBox', sheet);
      if (!box) return;
      box.innerHTML = '';
      $('#photoDel', sheet).style.display = state.photo ? '' : 'none';
      const hint = $('#photoHint', sheet);
      if (!state.photo) { hint.textContent = 'Фото сжимается до 1600 px и хранится на Яндекс.Диске.'; return; }
      let src = null;
      if (state.photoBlob) src = URL.createObjectURL(state.photoBlob);
      else src = await photoSrc(state.photo);
      if (!src) { hint.textContent = 'Фото есть в облаке — подключи Яндекс.Диск, чтобы посмотреть.'; return; }
      const im = document.createElement('img');
      im.className = 'thumb'; im.src = src; im.alt = 'чек';
      im.referrerPolicy = 'no-referrer';
      im.onclick = () => openPhotoViewer(src);
      box.appendChild(im);
      hint.textContent = state.photoPending ? 'Снято без сети — уедет на Диск при синхронизации.' : '';
    };

    $('#photoAdd', sheet).onclick = () => $('#photoCam', sheet).click();
    $('#photoGal', sheet).onclick = () => $('#photoFile', sheet).click();
    const onPhotoChosen = async e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      $('#photoHint', sheet).textContent = 'Сжимаю…';
      try {
        const blob = await shrinkImage(f);
        state.photoBlob = blob;
        state.photo = 'ph_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.jpg';
        state.photoPending = true;
        paintPhoto();
      } catch (err) { $('#photoHint', sheet).textContent = 'Не удалось обработать фото'; }
    };
    $('#photoCam', sheet).onchange = onPhotoChosen;
    $('#photoFile', sheet).onchange = onPhotoChosen;
    $('#photoDel', sheet).onclick = () => {
      state.photo = null; state.photoBlob = null; state.photoPending = false; paintPhoto();
    };
    paintPhoto();

    const applyKind = k => {
      state.kind = k;
      $$('#segKind button', sheet).forEach(b => b.classList.toggle('on', b.dataset.k === k));
      $('#acc2Wrap', sheet).style.display = k === 'tr' ? '' : 'none';
      $('#fSplitOn', sheet).style.display = k === 'tr' ? 'none' : '';
      if (k === 'tr') {
        setSplit(false);
        $('#catWrap', sheet).style.display = 'none';
      } else {
        $('#catWrap', sheet).style.display = state.split ? 'none' : '';
        refreshCats();
        recalcSplit();
      }
    };
    $$('#segKind button', sheet).forEach(b => b.onclick = () => applyKind(b.dataset.k));

    $('#fSave', sheet).onclick = async () => {
      const oldPhoto = t ? (t.photo || null) : null;
      const amt = Math.abs(Money.toMinor($('#fAmount', sheet).value));
      if (!amt) { toast('Введите сумму'); return; }
      const date = $('#fDate', sheet).value || D.today();
      const accId = $('#fAcc', sheet).value;
      const catId = state.kind === 'tr' ? null : $('#fCat', sheet).value;
      const payee = $('#fPayee', sheet).value.trim();
      const note = $('#fNote', sheet).value.trim();

      if (state.kind === 'tr') {
        const acc2 = $('#fAcc2', sheet).value;
        if (acc2 === accId) { toast('Выбери разные счета'); return; }
        const tid = uid();
        if (t) App.data.transactions = App.data.transactions.filter(x => x.id !== t.id);
        App.data.transactions.push({ id: tid, accountId: accId, date, amount: -amt, transferAccountId: acc2, note, updatedAt: Date.now() });
        App.data.transactions.push({ id: uid(), accountId: acc2, date, amount: amt, transferAccountId: accId, note, updatedAt: Date.now() });
      } else {
        const sign = state.kind === 'inc' ? 1 : -1;
        let splits = null;
        if (state.split) {
          const parts = $$('.srow', sheet).map(r => ({
            categoryId: $('.f-split-cat', r).value,
            amount: Math.abs(Money.toMinor($('.f-split-amt', r).value))
          })).filter(p => p.amount > 0);
          if (parts.length < 2) { toast('Нужно минимум две категории с суммой'); return; }
          const sum = parts.reduce((s, p) => s + p.amount, 0);
          if (sum > amt) { toast('Сумма частей больше операции на ' + Money.fmt(sum - amt)); return; }
          if (sum !== amt) { toast('Осталось распределить ' + Money.fmt(amt - sum)); return; }
          splits = parts.map(p => ({ categoryId: p.categoryId, amount: sign * p.amount }));
        }
        const amount = sign * amt;
        if (state.photo && state.photoBlob) {
          try { await PhotoStore.put(state.photo, state.photoBlob); } catch (e) {}
        }
        const patch = { accountId: accId, date, amount, categoryId: catId, payee, note, transferAccountId: null,
          photo: state.photo || null, photoPending: state.photo ? !!state.photoPending : false,
          updatedAt: Date.now(), splits: null };
        if (splits) { patch.splits = splits; patch.categoryId = splits[0].categoryId; }
        if (t) Object.assign(t, patch);
        else App.data.transactions.push(Object.assign({ id: uid() }, patch));
      }
      saveData(); closeSheet(); render();

      const token = ((App.data.settings.yd || {}).token || '').trim();
      if (oldPhoto && oldPhoto !== state.photo) {
        PhotoStore.del(oldPhoto).catch(() => {});
        if (token) ydPhotoDelete(token, oldPhoto);
      }
      if (state.photo && state.photoBlob && state.kind !== 'tr') {
        const name = state.photo, blob = state.photoBlob;
        (async () => {
          try {
            await PhotoStore.put(name, blob);
            if (!token) return;
            await ydPhotoUpload(token, name, blob);
            const tr = App.data.transactions.find(x => x.photo === name);
            if (tr) { tr.photoPending = false; saveData(); }
            toast('Фото загружено на Диск');
          } catch (e) { /* останется в очереди до следующей синхронизации */ }
        })();
      }
    };
    if (t) $('#fDel', sheet).onclick = () => {
      App.data.transactions = App.data.transactions.filter(x => x.id !== t.id && !(x.transferAccountId === t.accountId && x.date === t.date && x.amount === -t.amount && t.transferAccountId));
      saveData(); closeSheet(); render();
    };
  });
}

/* ---------- план ---------- */
function editPlan(id) {
  const p = id ? App.data.plans.find(x => x.id === id) : null;
  const accs = App.data.accounts.filter(a => !a.closed);
  if (!accs.length) { toast('Сначала добавь счёт'); return; }
  const isInc = p ? p.amount > 0 : true;
  const cats = App.data.categories.filter(c => c.type === (isInc ? 'income' : 'expense'));
  const accOpts = accs.map(a => `<option value="${a.id}" ${p && p.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const catOpts = cats.map(c => `<option value="${c.id}" ${p && p.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const rep = p && p.repeat ? p.repeat : { freq: 'month', interval: 1 };

  openSheet(`
    <h3>${p ? 'Плановая операция' : 'Новая плановая операция'}</h3>
    <div class="seg" id="segKind">
      <button data-k="exp" class="${!isInc ? 'on' : ''}">Расход</button>
      <button data-k="inc" class="${isInc ? 'on' : ''}">Доход</button>
    </div>
    <div class="field" style="margin-top:12px"><label>Сумма (плюс — доход, минус — расход)</label><input id="fAmount" inputmode="decimal" placeholder="0.00" value="${p ? (p.amount / 100).toFixed(2) : ''}"></div>
    <div class="field"><label>Счёт</label><select id="fAcc">${accOpts}</select></div>
    <div class="field"><label>Категория</label><select id="fCat">${catOpts}</select></div>
    <div class="field"><label>Название</label><input id="fPayee" value="${esc(p ? (p.payee || '') : '')}" placeholder="Зарплата, ипотека…"></div>
    <div class="two">
      <div class="field"><label>Повтор</label>
        <select id="fFreq">
          <option value="month" ${rep.freq === 'month' ? 'selected' : ''}>Каждый месяц</option>
          <option value="week" ${rep.freq === 'week' ? 'selected' : ''}>Каждую неделю</option>
          <option value="day" ${rep.freq === 'day' ? 'selected' : ''}>Каждый день</option>
          <option value="once" ${rep.freq === 'once' ? 'selected' : ''}>Один раз</option>
        </select>
      </div>
      <div class="field"><label>Интервал</label><input id="fInt" type="number" min="1" value="${rep.interval || 1}"></div>
    </div>
    <div class="two">
      <div class="field"><label>Первая дата</label><input id="fStart" type="date" value="${p ? p.startDate : D.today()}"></div>
      <div class="field"><label>До (необязательно)</label><input id="fEnd" type="date" value="${p && p.endDate ? p.endDate : ''}"></div>
    </div>
    <div class="actions">
      <button class="btn" id="fSave">Сохранить</button>
      ${p ? '<button class="btn danger" id="fDel">Удалить</button>' : ''}
    </div>
  `, sheet => {
    let kind = isInc ? 'inc' : 'exp';
    $$('#segKind button', sheet).forEach(b => b.onclick = () => {
      kind = b.dataset.k;
      $$('#segKind button', sheet).forEach(x => x.classList.toggle('on', x === b));
      const list = App.data.categories.filter(c => c.type === (kind === 'inc' ? 'income' : 'expense'));
      $('#fCat', sheet).innerHTML = list.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    });
    $('#fSave', sheet).onclick = () => {
      const val = Money.toMinor($('#fAmount', sheet).value);
      if (!val) { toast('Введите сумму'); return; }
      const amount = kind === 'inc' ? Math.abs(val) : -Math.abs(val);
      const startDate = $('#fStart', sheet).value || D.today();
      const freq = $('#fFreq', sheet).value;
      const interval = Math.max(1, +$('#fInt', sheet).value || 1);
      const endDate = $('#fEnd', sheet).value || null;
      const obj = {
        accountId: $('#fAcc', sheet).value,
        categoryId: $('#fCat', sheet).value,
        payee: $('#fPayee', sheet).value.trim(),
        amount, startDate, endDate,
        repeat: freq === 'once' ? null : { freq, interval },
        updatedAt: Date.now()
      };
      if (p) Object.assign(p, obj);
      else App.data.plans.push(Object.assign({ id: uid(), deleted: false }, obj));
      saveData(); closeSheet(); render();
    };
    if (p) $('#fDel', sheet).onclick = () => {
      if (!confirm('Удалить плановую операцию?')) return;
      p.deleted = true; saveData(); closeSheet(); render();
    };
  });
}

/* ---------- бэкап JSON ---------- */
function manualYandexToken() {
  openSheet(`
    <h3>Токен Яндекс.Диска</h3>
    <div class="field"><label>OAuth-токен</label><input id="ydTok" type="password" placeholder="y0_Ag…"></div>
    <div class="hint">Токен можно получить на oauth.yandex.ru. Хранится только на этом устройстве.</div>
    <div class="actions"><button class="btn" id="fSave">Сохранить</button></div>
  `, sheet => {
    $('#fSave', sheet).onclick = () => {
      const t = $('#ydTok', sheet).value.trim();
      if (!t) { toast('Поле пустое'); return; }
      App.data.settings.yd = { token: t };
      saveData(); closeSheet(); render(); toast('Токен сохранён');
    };
  });
}

/* ---------- очистка ---------- */
async function wipeLocal() {
  if (!confirm('Очистить базу на этом устройстве? Счета, операции, категории и фото будут удалены.')) return;
  if (!confirm('Точно удалить? Отменить не получится. Бэкап лучше сначала скачать.')) return;
  const keep = App.data.settings;
  App.data = emptyData();
  App.data.settings = keep || {};
  try {
    const db = await PhotoStore.open();
    await new Promise(res => {
      const tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').clear();
      tx.oncomplete = res; tx.onerror = res; tx.onabort = res;
    });
  } catch (e) { /* кэш фото не критичен */ }
  saveData(); render(); toast('База очищена');
}

async function wipeCloud() {
  const token = ((App.data.settings.yd || {}).token || '').trim();
  if (!token) { toast('Сначала подключи Яндекс.Диск'); return; }
  if (!confirm('Удалить файл базы на Яндекс.Диске (app:/Cash/cash-data.json)?\n\nНа других устройствах данные останутся только локально.')) return;
  try {
    const r = await ydReq(YD.api + '/resources?path=' + encodeURIComponent(YD.file), token, { method: 'DELETE' });
    if (!r.ok && r.status !== 404) throw httpErr('удаление', r);
    App.syncStatus = 'Бэкап на Диске удалён: ' + new Date().toLocaleTimeString('ru-RU');
    render();
    toast('Бэкап удалён');
  } catch (e) {
    toast('Не удалось: ' + ((e && e.message) || e));
  }
}

function exportJSON() {  const blob = new Blob([JSON.stringify(App.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cash-backup-' + D.today() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Бэкап скачан');
}

function importJSONFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!d || !Array.isArray(d.accounts)) throw new Error('не похоже на бэкап Cash');
      if (!confirm('Заменить текущие данные данными из файла?')) return;
      App.data = Object.assign(emptyData(), d);
      App.data.settings = Object.assign({ currency: '₽', horizon: 6, tg: {}, yd: {} }, d.settings || {});
      saveData(); render();
      toast('Данные восстановлены');
    } catch (e) { toast('Ошибка: ' + e.message); }
  };
  reader.readAsText(file);
}

/* ---------- запуск ---------- */
function init() {
  loadData();
  if (YA.consumeToken()) {
    toast('Яндекс.Диск подключён');
    App.tab = 'settings';
  }
  const h = location.hash.replace('#', '');
  if (['accounts', 'transactions', 'plans', 'forecast', 'settings'].indexOf(h) >= 0) App.tab = h;
  render();
  $$('#tabs button').forEach(b => b.onclick = () => { App.tab = b.dataset.tab; location.hash = b.dataset.tab; render(); });
  document.addEventListener('change', e => {
    if (e.target.id === 'importFile' && e.target.files[0]) importJSONFile(e.target.files[0]);
    if (e.target.id === 'ydToken') { App.data.settings.yd = { token: e.target.value.trim() }; saveData(); }
    if (e.target.id === 'tgToken') { App.data.settings.tg = Object.assign({}, App.data.settings.tg, { token: e.target.value.trim() }); saveData(); }
    if (e.target.id === 'tgChat') { App.data.settings.tg = Object.assign({}, App.data.settings.tg, { chatId: e.target.value.trim() }); saveData(); }
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);




