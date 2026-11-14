/* ui.js — интерфейс приложения */

const App = {
  data: null,
  tab: 'accounts',
  month: null,
  horizon: 6,
  syncStatus: ''
};

const STORE_KEY = 'cash.data.v1';

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
function catName(id) { const c = App.data.categories.find(x => x.id === id); return c ? c.name : 'Без категории'; }
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
  let rows = accs.map(a => {
    const bal = accountBalance(App.data, a.id);
    return `<div class="row" data-edit-acc="${a.id}">
      <div class="ico">${ICON_SVG[a.type] || ICON_SVG.cash}</div>
      <div class="grow"><div class="title">${esc(a.name)}</div><div class="sub">${accTypeName(a.type)}</div></div>
      <div class="amount ${bal < 0 ? 'neg' : ''}">${Money.fmt(bal)}</div>
    </div>`;
  }).join('');
  if (!accs.length) rows = '<div class="empty">Пока нет счетов.<br>Добавь первый — наличные, карту или вклад.</div>';
  return `
    <div class="card"><h2>Мои счета</h2>${rows || '<div class="empty">Пусто</div>'}</div>
    <div class="fab-row">
      <button class="btn block" data-act="add-acc">+ Добавить счёт</button>
    </div>
    <div class="hint">Нажми на счёт, чтобы изменить или удалить. Итог по всем счетам — в шапке.</div>`;
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
      const icon = isTr ? ICON_SVG.transfer : isInc ? ICON_SVG.inc : ICON_SVG.exp;
      const cls = isTr ? '' : isInc ? 'inc' : 'exp';
      const sub = isTr ? '→ ' + accName(t.transferAccountId) : catName(t.categoryId) + (t.payee ? ' · ' + t.payee : '');
      return `<div class="row" data-edit-tx="${t.id}">
        <div class="ico ${cls}">${icon}</div>
        <div class="grow"><div class="title">${esc(isTr ? 'Перевод' : (t.payee || catName(t.categoryId)))}</div>
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
    </div>

    <div class="card">
      <h2>Яндекс.Диск</h2>
      <div class="field"><label>OAuth-токен</label><input id="ydToken" type="password" placeholder="вставь токен" value="${esc((s.yd || {}).token || '')}"></div>
      <div class="fab-row" style="margin:0">
        <button class="btn" data-act="yd-sync" style="flex:1">Синхронизировать</button>
      </div>
      <div class="hint" id="ydStatus">${esc(App.syncStatus || 'Файл хранится в app:/Cash/cash-data.json')}</div>
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
      <div class="hint">Версия 0.1 · ${esc(navigator.userAgent.includes('Android') ? 'Android' : 'ПК')}</div>
    </div>`;
}

/* ---------- обработчики ---------- */
function bindView() {
  const view = $('#view');
  $$('[data-act]', view).forEach(b => b.onclick = () => act(b.dataset.act));
  $$('[data-edit-acc]', view).forEach(r => r.onclick = () => editAccount(r.dataset.editAcc));
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
  else if (name === 'yd-sync') yandexSync();
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
    <div class="actions">
      <button class="btn" id="fSave">Сохранить</button>
      ${a ? '<button class="btn danger" id="fDel">Удалить</button>' : ''}
    </div>
  `, sheet => {
    $('#fSave', sheet).onclick = () => {
      const name = $('#fName', sheet).value.trim() || 'Счёт';
      const type = $('#fType', sheet).value;
      const opening = Money.toMinor($('#fOpen', sheet).value);
      if (a) { Object.assign(a, { name, type, opening, updatedAt: Date.now() }); }
      else App.data.accounts.push({ id: uid(), name, type, opening, sort: App.data.accounts.length, closed: false, updatedAt: Date.now() });
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

  const accOpts = sel => accs.map(a => `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const cats = App.data.categories.filter(c => c.type === (isInc ? 'income' : 'expense'));
  const catOpts = sel => cats.map(c => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  openSheet(`
    <h3>${t ? 'Операция' : isTr ? 'Перевод' : isInc ? 'Доход' : 'Расход'}</h3>
    <div class="seg" id="segKind">
      <button data-k="exp" class="${!isInc && !isTr ? 'on' : ''}">Расход</button>
      <button data-k="inc" class="${isInc && !isTr ? 'on' : ''}">Доход</button>
      <button data-k="tr" class="${isTr ? 'on' : ''}">Перевод</button>
    </div>
    <div class="field" style="margin-top:12px"><label>Сумма</label><input id="fAmount" inputmode="decimal" placeholder="0.00" value="${amountVal}"></div>
    <div class="field"><label>Дата</label><input id="fDate" type="date" value="${t ? t.date : D.today()}"></div>
    <div class="field" id="accWrap"><label>${isTr ? 'Со счёта' : 'Счёт'}</label><select id="fAcc">${accOpts(t ? t.accountId : accs[0].id)}</select></div>
    <div class="field" id="acc2Wrap" style="${isTr ? '' : 'display:none'}"><label>На счёт</label><select id="fAcc2">${accOpts(t && t.transferAccountId ? t.transferAccountId : (accs[1] || accs[0]).id)}</select></div>
    <div class="field" id="catWrap" style="${isTr ? 'display:none' : ''}"><label>Категория</label><select id="fCat">${catOpts(t ? t.categoryId : cats[0].id)}</select></div>
    <div class="field"><label>Контрагент / название</label><input id="fPayee" value="${esc(t ? (t.payee || '') : '')}" placeholder="Пятёрочка, зарплата…"></div>
    <div class="field"><label>Заметка</label><input id="fNote" value="${esc(t ? (t.note || '') : '')}"></div>
    <div class="actions">
      <button class="btn" id="fSave">Сохранить</button>
      ${t ? '<button class="btn danger" id="fDel">Удалить</button>' : ''}
    </div>
  `, sheet => {
    const state = { kind: isTr ? 'tr' : isInc ? 'inc' : 'exp' };
    const refreshCats = k => {
      const list = App.data.categories.filter(c => c.type === (k === 'inc' ? 'income' : 'expense'));
      $('#fCat', sheet).innerHTML = list.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    };
    const applyKind = k => {
      state.kind = k;
      $$('#segKind button', sheet).forEach(b => b.classList.toggle('on', b.dataset.k === k));
      $('#acc2Wrap', sheet).style.display = k === 'tr' ? '' : 'none';
      $('#catWrap', sheet).style.display = k === 'tr' ? 'none' : '';
      if (k !== 'tr') refreshCats(k);
    };
    $$('#segKind button', sheet).forEach(b => b.onclick = () => applyKind(b.dataset.k));

    $('#fSave', sheet).onclick = () => {
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
        const amount = state.kind === 'inc' ? amt : -amt;
        if (t) Object.assign(t, { accountId: accId, date, amount, categoryId: catId, payee, note, transferAccountId: null, updatedAt: Date.now() });
        else App.data.transactions.push({ id: uid(), accountId: accId, date, amount, categoryId: catId, payee, note, updatedAt: Date.now() });
      }
      saveData(); closeSheet(); render();
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
function exportJSON() {
  const blob = new Blob([JSON.stringify(App.data, null, 2)], { type: 'application/json' });
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
