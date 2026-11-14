/* sync.js — Яндекс.Диск (REST API) и Telegram-бот (бэкап) */

const YD = {
  api: 'https://cloud-api.yandex.net/v1/disk',
  folder: 'app:/Cash',
  file: 'app:/Cash/cash-data.json'
};

async function ydReq(url, token, opts) {
  const r = await fetch(url, Object.assign({
    headers: Object.assign({ Authorization: 'OAuth ' + token }, (opts && opts.headers) || {})
  }, opts || {}));
  return r;
}

async function ydEnsureFolder(token) {
  const r = await ydReq(YD.api + '/resources?path=' + encodeURIComponent(YD.folder), token, { method: 'PUT' });
  // 201 создано, 409 уже есть — оба варианта нормальны
  if (!r.ok && r.status !== 409) throw new Error('папка: HTTP ' + r.status);
}

async function ydDownload(token) {
  const meta = await ydReq(YD.api + '/resources/download?path=' + encodeURIComponent(YD.file), token);
  if (meta.status === 404) return null;
  if (!meta.ok) throw new Error('файл: HTTP ' + meta.status);
  const { href } = await meta.json();
  const file = await fetch(href);
  if (!file.ok) throw new Error('скачивание: HTTP ' + file.status);
  return await file.text();
}

async function ydUpload(token, text) {
  const up = await ydReq(YD.api + '/resources/upload?path=' + encodeURIComponent(YD.file) + '&overwrite=true', token);
  if (!up.ok) throw new Error('upload-url: HTTP ' + up.status);
  const { href } = await up.json();
  const put = await fetch(href, { method: 'PUT', body: text, headers: { 'Content-Type': 'application/json' } });
  if (!put.ok) throw new Error('загрузка: HTTP ' + put.status);
}

/* слияние: побеждает запись с более свежим updatedAt */
function mergeList(local, remote) {
  const map = new Map();
  for (const x of local) map.set(x.id, x);
  for (const x of remote) {
    const cur = map.get(x.id);
    if (!cur) { map.set(x.id, x); continue; }
    if ((x.updatedAt || 0) > (cur.updatedAt || 0)) map.set(x.id, x);
  }
  return Array.from(map.values());
}

function mergeData(local, remote) {
  const out = JSON.parse(JSON.stringify(local));
  out.accounts = mergeList(local.accounts || [], remote.accounts || []);
  out.transactions = mergeList(local.transactions || [], remote.transactions || []);
  out.plans = mergeList(local.plans || [], remote.plans || []);
  const catMap = new Map();
  for (const c of (local.categories || [])) catMap.set(c.id, c);
  for (const c of (remote.categories || [])) if (!catMap.has(c.id)) catMap.set(c.id, c);
  out.categories = Array.from(catMap.values());
  const lt = (local.settings && local.settings.tg) || {};
  const rt = (remote.settings && remote.settings.tg) || {};
  out.settings = Object.assign({}, remote.settings || {}, local.settings || {});
  out.settings.tg = Object.assign({}, rt, lt);
  out.settings.yd = Object.assign({}, (remote.settings && remote.settings.yd) || {}, (local.settings && local.settings.yd) || {});
  return out;
}

function setSyncStatus(msg) {
  App.syncStatus = msg;
  const el = document.getElementById('ydStatus');
  if (el) el.textContent = msg;
}

async function yandexSync() {
  const token = ((App.data.settings.yd || {}).token || '').trim();
  if (!token) { toast('Вставь OAuth-токен Яндекс.Диска'); return; }
  setSyncStatus('Синхронизация…');
  try {
    await ydEnsureFolder(token);
    const remoteText = await ydDownload(token);
    let merged = App.data;
    if (remoteText) {
      let remote;
      try { remote = JSON.parse(remoteText); } catch (e) { throw new Error('файл на диске повреждён'); }
      merged = mergeData(App.data, remote);
    }
    App.data = Object.assign(emptyData(), merged);
    App.data.settings = Object.assign({ currency: '₽', horizon: 6, tg: {}, yd: {} }, App.data.settings || {});
    saveData();
    await ydUpload(token, JSON.stringify(App.data));
    render();
    setSyncStatus('Готово: ' + new Date().toLocaleTimeString('ru-RU'));
    toast('Синхронизировано с Яндекс.Диском');
  } catch (e) {
    setSyncStatus('Ошибка: ' + e.message);
    toast('Не удалось: ' + e.message);
  }
}

async function telegramSend() {
  const tg = App.data.settings.tg || {};
  const token = (tg.token || '').trim();
  const chatId = (tg.chatId || '').trim();
  if (!token || !chatId) { toast('Укажи токен бота и chat id'); return; }
  try {
    const fd = new FormData();
    fd.append('chat_id', chatId);
    fd.append('caption', 'Бэкап Cash ' + D.ru(D.today()));
    fd.append('document', new Blob([JSON.stringify(App.data, null, 2)], { type: 'application/json' }), 'cash-backup-' + D.today() + '.json');
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendDocument', { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error((j.description || ('HTTP ' + r.status)));
    toast('Бэкап отправлен в Telegram');
  } catch (e) {
    toast('Telegram недоступен: ' + e.message);
  }
}
