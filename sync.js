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
  file: 'app:/Cash/cash-data.json',
  photos: 'app:/Cash/photos'
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
  if (!href) throw new Error('Диск не выдал ссылку на файл');
  return await ydGetHref(href, token, 'text');
}

/* скачивание по выданной ссылке: обычный fetch → fetch с токеном → XHR.
   У Яндекса ссылка ведёт на отдельный хост, и в мобильных браузерах обычный
   запрос иногда режется, поэтому пробуем несколько путей. */
function xhrGet(url, token, as) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open('GET', url, true);
    if (token) x.setRequestHeader('Authorization', 'OAuth ' + token);
    x.responseType = as === 'blob' ? 'blob' : 'text';
    x.timeout = 25000;
    x.onload = () => (x.status >= 200 && x.status < 300)
      ? res(x.responseType === 'blob' ? x.response : x.responseText)
      : rej(Object.assign(new Error('HTTP ' + x.status), { status: x.status }));
    x.onerror = () => rej(new TypeError('XHR: сеть недоступна'));
    x.ontimeout = () => rej(new TypeError('XHR: таймаут'));
    x.send();
  });
}

/* у ссылки на скачивание бывает недоступен хост downloader.disk.yandex.ru
   (блокировки, DNS, защита браузера). Подпись к хосту не привязана —
   та же ссылка работает с .net и .com. */
function ydHrefVariants(href) {
  const s = String(href);
  const list = [s];
  const m = s.match(/^https:\/\/([^/]+)(\/.*)$/);
  if (m && m[1] === 'downloader.disk.yandex.ru') {
    list.push('https://downloader.disk.yandex.net' + m[2]);
    list.push('https://downloader.disk.yandex.com' + m[2]);
  }
  return list;
}

async function ydGetHref(href, token, as) {
  const errors = [];
  for (const url of ydHrefVariants(href)) {
    const host = (String(url).match(/^https:\/\/([^/:]+)/) || [])[1] || '?';
    for (const withAuth of [false, true]) {
      try {
        /* Яндекс отдаёт 403, если пришёл чужой Referer (защита от хотлинка),
           поэтому просим браузер его не отправлять */
        const opts = { referrerPolicy: 'no-referrer' };
        if (withAuth) opts.headers = { Authorization: 'OAuth ' + token };
        const r = await fetch(url, opts);
        if (!r.ok) throw httpErr('скачивание', r);
        return as === 'blob' ? await r.blob() : await r.text();
      } catch (e) {
        errors.push(host + (withAuth ? ' + токен' : '') + ': ' + e.message);
      }
    }
  }
  try { return await xhrGet(href, token, as); }
  catch (e) { errors.push('XHR: ' + e.message); }
  throw new Error(errors.join(' · '));
}

async function ydUpload(token, text) {
  const up = await ydReq(YD.api + '/resources/upload?path=' + encodeURIComponent(YD.file) + '&overwrite=true', token);
  if (!up.ok) throw httpErr('upload-url', up);
  const { href } = await up.json();
  const put = await fetch(href, { method: 'PUT', body: text, headers: { 'Content-Type': 'application/json' } });
  if (!put.ok) throw httpErr('загрузка', put);
}

/* ---------- фото чеков на Диске ---------- */
async function ydPhotoUpload(token, name, blob) {
  const up = await ydReq(YD.api + '/resources/upload?path=' + encodeURIComponent(YD.photos + '/' + name) + '&overwrite=true', token);
  if (!up.ok) throw httpErr('upload-url фото', up);
  const { href } = await up.json();
  const put = await fetch(href, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
  if (!put.ok) throw httpErr('загрузка фото', put);
}

async function ydPhotoHref(token, name) {
  const r = await ydReq(YD.api + '/resources/download?path=' + encodeURIComponent(YD.photos + '/' + name), token);
  if (!r.ok) throw httpErr('фото', r);
  return (await r.json()).href;
}

async function ydPhotoDelete(token, name) {
  try {
    const r = await ydReq(YD.api + '/resources?path=' + encodeURIComponent(YD.photos + '/' + name), token, { method: 'DELETE' });
    return r.ok || r.status === 404;
  } catch (e) { return false; }
}

/* догружает на Диск фото, снятые без сети */
async function flushPendingPhotos(token) {
  if (typeof PhotoStore === 'undefined') return 0;
  const list = (App.data.transactions || []).filter(t => t.photo && t.photoPending && !t.deleted);
  let done = 0;
  for (const t of list) {
    try {
      const blob = await PhotoStore.get(t.photo);
      if (!blob) continue;
      await ydPhotoUpload(token, t.photo, blob);
      t.photoPending = false;
      done++;
    } catch (e) { /* попробуем при следующей синхронизации */ }
  }
  if (done) saveData();
  return done;
}

/* пошаговая проверка Диска: показывает, на каком запросе рвётся */
async function ydDoctor() {
  const token = ((App.data.settings.yd || {}).token || '').trim();
  if (!token) { toast('Сначала войди в Яндекс'); return; }
  const out = [];
  const step = async (name, fn) => {
    try { const info = await fn(); out.push('✔ ' + name + (info ? ': ' + info : '')); }
    catch (e) { out.push('✘ ' + name + ': ' + ((e && e.message) || e) + (e && e.status ? ' [HTTP ' + e.status + ']' : '')); }
  };

  await step('Яндекс ID', async () => {
    const r = await fetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: 'OAuth ' + token } });
    if (!r.ok) throw httpErr('whoami', r);
    const j = await r.json();
    return j.login || j.default_email || 'ok';
  });
  await step('Диск', async () => {
    const r = await fetch(YD.api + '/?fields=total_space,used_space', { headers: { Authorization: 'OAuth ' + token } });
    if (!r.ok) throw httpErr('диск', r);
    const j = await r.json();
    const free = Math.round(((j.total_space || 0) - (j.used_space || 0)) / 1048576);
    return free + ' МБ свободно';
  });
  await step('папка app:/Cash', async () => { await ydEnsureFolder(token); return 'ok'; });
  await step('чтение данных', async () => {
    const r = await ydReq(YD.api + '/resources/download?path=' + encodeURIComponent(YD.file), token);
    if (r.status === 404) return 'файла ещё нет';
    if (!r.ok) throw httpErr('файл', r);
    const j = await r.json();
    if (!j.href) throw new Error('в ответе API нет ссылки');
    const host = (String(j.href).match(/^https:\/\/([^/:]+)/) || [])[1] || '?';
    const text = await ydGetHref(j.href, token, 'text');
    return 'хост ' + host + ' · прочитано ' + text.length + ' симв.';
  });
  const probe = async (label, contentType) => {
    await step(label, async () => {
      const path = YD.folder + '/probe.json';
      const r = await ydReq(YD.api + '/resources/upload?path=' + encodeURIComponent(path) + '&overwrite=true', token);
      if (!r.ok) throw httpErr('upload-url', r);
      const { href } = await r.json();
      const host = (String(href).match(/^https:\/\/([^/:]+)/) || [])[1] || '?';
      const opts = { method: 'PUT', body: '{"probe":1}' };
      if (contentType) opts.headers = { 'Content-Type': contentType };
      const put = await fetch(href, opts);
      if (!put.ok) throw httpErr('PUT', put);
      ydReq(YD.api + '/resources?path=' + encodeURIComponent(path), token, { method: 'DELETE' }).catch(() => {});
      return 'ok, хост ' + host;
    });
  };
  await probe('запись 1 КБ (application/json)', 'application/json');
  await probe('запись 1 КБ (text/plain, без preflight)', null);

  out.push('');
  out.push('браузер: ' + navigator.userAgent);
  showDoctor(out.join('\n'));
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
  let step = 'папка';
  setSyncStatus('Синхронизация: папка…');
  try {
    await ydEnsureFolder(token);
    step = 'фото';
    setSyncStatus('Синхронизация: фото…');
    await flushPendingPhotos(token);
    step = 'чтение';
    setSyncStatus('Синхронизация: чтение…');
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
    step = 'запись';
    setSyncStatus('Синхронизация: запись…');
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
    const msg = step + ': ' + ydHumanError(e);
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


