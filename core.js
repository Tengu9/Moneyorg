/* core.js — данные, деньги, даты, прогноз. Работает и в браузере, и в Node (для тестов). */

/* ---------- деньги ---------- */
const Money = {
  toMinor(v) {
    if (typeof v === 'number') return Math.round(v * 100);
    const s = String(v == null ? '' : v).replace(/\s|\u00A0/g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
    if (!s || s === '-' || s === '.') return 0;
    return Math.round(parseFloat(s) * 100) || 0;
  },
  fmt(minor, sign) {
    const v = Math.round(minor) / 100;
    const abs = Math.abs(v);
    const s = abs.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const mark = sign ? (v > 0 ? '+' : v < 0 ? '−' : '') : (v < 0 ? '−' : '');
    return mark + s + ' ₽';
  },
  fmtShort(minor) {
    const v = Math.round(minor) / 100;
    const a = Math.abs(v);
    const r = a >= 1e6 ? (a / 1e6).toFixed(1).replace('.0', '') + ' млн'
      : a >= 1e3 ? (a / 1e3).toFixed(0) + ' тыс'
      : String(Math.round(a));
    return (v < 0 ? '−' : '') + r + ' ₽';
  },
  groupDigits(intStr) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
};

/* ---------- даты (строки YYYY-MM-DD, без сдвигов TZ) ---------- */
const D = {
  pad(n) { return String(n).padStart(2, '0'); },
  today() { const d = new Date(); return d.getFullYear() + '-' + D.pad(d.getMonth() + 1) + '-' + D.pad(d.getDate()); },
  parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0); },
  str(d) { return d.getFullYear() + '-' + D.pad(d.getMonth() + 1) + '-' + D.pad(d.getDate()); },
  addDays(s, n) { const d = D.parse(s); d.setDate(d.getDate() + n); return D.str(d); },
  addMonths(s, n) {
    const d = D.parse(s); const day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return D.str(d);
  },
  addMonthsClampDay(s, n, dayOfMonth) {
    const d = D.parse(s);
    d.setDate(1); d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(dayOfMonth, last));
    return D.str(d);
  },
  diffDays(a, b) { return Math.round((D.parse(b) - D.parse(a)) / 86400000); },
  cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; },
  ru(s) { const d = D.parse(s); return D.pad(d.getDate()) + '.' + D.pad(d.getMonth() + 1) + '.' + d.getFullYear(); },
  ruShort(s) { const d = D.parse(s); const m = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']; return d.getDate() + ' ' + m[d.getMonth()]; },
  monthName(s) { const d = D.parse(s); const m = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']; return m[d.getMonth()] + ' ' + d.getFullYear(); }
};

/* ---------- модель ---------- */
const DEFAULT_CATEGORIES = [
  { id: 'c_food', name: 'Продукты', type: 'expense' },
  { id: 'c_home', name: 'Дом', type: 'expense' },
  { id: 'c_transport', name: 'Транспорт', type: 'expense' },
  { id: 'c_health', name: 'Здоровье', type: 'expense' },
  { id: 'c_fun', name: 'Развлечения', type: 'expense' },
  { id: 'c_credit', name: 'Кредиты', type: 'expense' },
  { id: 'c_other', name: 'Прочее', type: 'expense' },
  { id: 'i_salary', name: 'Зарплата', type: 'income' },
  { id: 'i_other', name: 'Прочий доход', type: 'income' }
];

function emptyData() {
  return {
    version: 1,
    accounts: [],
    categories: DEFAULT_CATEGORIES.slice(),
    transactions: [],
    plans: [],
    settings: { currency: '₽', horizon: 6, tg: {}, yd: {} }
  };
}

function uid() { return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

/* ---------- вычисления ---------- */
function accountBalance(data, accId, uptoDate) {
  const acc = data.accounts.find(a => a.id === accId);
  if (!acc) return 0;
  let sum = acc.opening || 0;
  for (const t of data.transactions) {
    if (t.deleted || t.accountId !== accId) continue;
    if (uptoDate && D.cmp(t.date, uptoDate) > 0) continue;
    sum += t.amount;
  }
  return sum;
}

function totalBalance(data, uptoDate) {
  return data.accounts.filter(a => !a.closed).reduce((s, a) => s + accountBalance(data, a.id, uptoDate), 0);
}

/**
 * Разворачивает план в даты в диапазоне [from, to].
 * plan.repeat = {freq: 'day'|'week'|'month', interval: n} или null (разовый).
 */
function planOccurrences(plan, from, to) {
  const out = [];
  if (plan.deleted) return out;
  const start = plan.startDate || from;
  const end = plan.endDate || to;
  const rep = plan.repeat && plan.repeat.freq ? plan.repeat : null;
  const limit = D.cmp(end, to) < 0 ? end : to;
  if (!rep) {
    if (D.cmp(start, to) <= 0 && D.cmp(start, from) >= 0) out.push(start);
    else if (D.cmp(start, from) < 0 && D.cmp(start, to) >= 0 && D.cmp(start, limit) <= 0) {
      // разовый в прошлом — в прогноз не попадает
    }
    return out;
  }
  const step = Math.max(1, rep.interval || 1);
  const dayOfMonth = D.parse(start).getDate();
  let cur = start;
  let guard = 0;
  while (D.cmp(cur, limit) <= 0 && guard++ < 5000) {
    if (D.cmp(cur, from) >= 0) out.push(cur);
    if (rep.freq === 'day') cur = D.addDays(cur, step);
    else if (rep.freq === 'week') cur = D.addDays(cur, 7 * step);
    else cur = D.addMonthsClampDay(cur, step, dayOfMonth);
  }
  return out;
}

/**
 * Прогноз: точки по дням от today до today + months.
 * Возвращает {points, startBalance, min, minDate, zeroDate, endBalance}
 */
function forecast(data, months, todayOverride) {
  const today = todayOverride || D.today();
  const end = D.addMonths(today, months);
  const startBalance = totalBalance(data);

  // события: дата -> сумма
  const events = new Map();
  for (const p of data.plans) {
    if (p.deleted) continue;
    for (const d of planOccurrences(p, today, end)) {
      events.set(d, (events.get(d) || 0) + (p.amount || 0));
    }
  }

  const points = [];
  let bal = startBalance;
  let min = bal, minDate = today;
  let zeroDate = null;
  const days = Math.min(D.diffDays(today, end), 1000);
  for (let i = 0; i <= days; i++) {
    const d = D.addDays(today, i);
    if (i > 0) bal += events.get(d) || 0;
    points.push({ date: d, balance: bal });
    if (bal < min) { min = bal; minDate = d; }
    if (zeroDate === null && i > 0 && bal >= 0 && points[i - 1].balance < 0) zeroDate = d;
  }
  return { points, startBalance, min, minDate, zeroDate, endBalance: bal, endDate: end };
}

/* экспорт для Node-тестов */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Money, D, DEFAULT_CATEGORIES, emptyData, uid, accountBalance, totalBalance, planOccurrences, forecast };
}
