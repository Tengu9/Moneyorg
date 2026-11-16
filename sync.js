/* sync.js — Яндекс.Диск (REST API), Telegram-бот (бэкап) */

/* Яндекс ID: OAuth2 implicit flow, токен приходит в #access_token */
const YA = {
  clientId: 'cc4ea298b42243e591f0fc5179beaaf1',
  redirect: 'https://moneyorg.tengu9.ru',
  authUrl() {
    const params = new URLSearchParams({
      response_type: 'token',
      client_id: YA.clientId,
      redirect_uri: YA.redirect
    });
    return 'https://oauth.yandex.ru/authorize?' + params.toString();
  },
  login() {
    if (location.protocol === 'file:') { toast('Вход работает только на сайте https://moneyorg.tengu9.ru'); return; }
    location.href = YA.authUrl();
  },
  /** возвращает true, если в адресе был токен и он сохранён */
  consumeToken() {
    if (!location.hash || location.hash.indexOf('access_token=') < 0) return false;
    const p = new URLSearchParams(location.hash.slice(1));
    const token = p.get('access_token');
    if (!token) return false;
    App.data.settings.yd = Object.assign({}, App.data.settings.yd || {}, { token, since: Date.now() });
    saveData();
    history.replaceState(null, '', location.pathname + location.search);
    YA.whoami(token).then(login => {
      if (login) {
        App.data.settings.yd.login = login;
        saveData();
        if (App.tab === 'settings') render();
      }
    }).catch(() => {});
    return true;
  },
  async whoami(token) {
    try {
      const r = await fetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: 'OAuth ' + token } });
      if (!r.ok) return null;
      const j = await r.json();
      return j.default_email || j.login || '';
    } catch (e) { return null; }
  }
};

function httpErr(prefix, r) {
  const e = new Error(prefix + ': HTTP ' + r.status);
  e.status = r.status;
  return e;
}

function ydHumanError(e) {
  if (e.status === 401) return 'Яндекс не принял токен — он истёк или отозван. Войди заново.';
  if (e.status === 403) return 'У приложения нет прав на Яндекс.Диск — включи доступ в oauth.yandex.ru и войди заново.';
  if (e.status === 404) return 'Файла на Диске ещё нет.';
  if (e.status === 507) return 'Закончилось место на Яндекс.Диске.';
  if (e.status === 429) return 'Слишком много запросов к Диску — подожди минуту.';
  return e.message;
}

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
  if (!r.ok && r.status !== 409) throw httpErr('папка', r);
}

async function ydDownload(token) {
  const meta = await ydReq(YD.api + '/resources/download?path=' + encodeURIComponent(YD.file), token);
  if (meta.status === 404) return null;
  if (!meta.ok) throw httpErr('файл', meta);
  const { href } = await meta.json();
  const file = await fetch(href);
  if (!file.ok) throw httpErr('скачивание', file);
  return await file.text();
}

async function ydUpload(token, text) {
  const up = await ydReq(YD.api + '/resources/upload?path=' + encodeURIComponent(YD.file) + '&overwrite=true', token);
  if (!up.ok) throw httpErr('upload-url', up);
  const { href } = await up.json();
  const put = await fetch(href, { method: 'PUT', body: text, headers: { 'Content-Type': 'application/json' } });
  if (!put.ok) throw httpErr('загрузка', put);
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
    if (e.status === 401 || e.status === 403) {
      App.data.settings.yd = Object.assign({}, App.data.settings.yd || {}, { token: '', expired: true });
      saveData();
      render();
    }
    const msg = ydHumanError(e);
    setSyncStatus(msg);
    toast(msg);
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


