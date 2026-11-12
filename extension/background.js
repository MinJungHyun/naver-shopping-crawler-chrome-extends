importScripts('core.js', 'server.js');
const { parseKeywords, searchUrl, matchesPage, mergeItems, randomSeconds, normalizeSettings } = NSC;
const NEXT = 'next-keyword', WATCH = 'collector-watchdog', CHECK = 'collector-url-check';
let queue = Promise.resolve();
const serial = fn => { const task = queue.then(fn); queue = task.catch(() => {}); return task; };
const read = async () => { const value = await chrome.storage.local.get(['job', 'items']); return { job: value.job || null, items: value.items || [] }; };
const save = value => chrome.storage.local.set(value);
const SERVER_CONFIG = 'serverConnection';
let serverStorageError = false;
const serverStorageReady = Promise.resolve().then(() => chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }))
  .catch(() => { serverStorageError = true; });
async function serverSettings(message, sender) {
  if (!trustedDashboard(sender)) throw new Error('수집기 관리 화면에서 실행하세요.');
  await serverStorageReady;
  if (serverStorageError) throw new Error('토큰 저장 보호 설정에 실패했습니다. 확장 프로그램을 새로고침하세요.');
  const stored = (await chrome.storage.local.get([SERVER_CONFIG]))[SERVER_CONFIG];
  if (message.type === 'GET_SERVER_CONFIG') return { server: NSCServer.publicConfig(stored) };
  if (['CLEAR_SERVER_CONFIG', 'SAVE_SERVER_CONFIG'].includes(message.type)) {
    const { job } = await read();
    if (job?.server && ['running', 'paused'].includes(job.status)) throw new Error('현재 서버 수집을 종료한 뒤 연결을 변경하세요.');
  }
  if (message.type === 'CLEAR_SERVER_CONFIG') {
    await chrome.storage.local.remove(SERVER_CONFIG);
    return { server: NSCServer.publicConfig(null) };
  }
  if (message.type === 'SAVE_SERVER_CONFIG') {
    const config = NSCServer.connection(message, stored);
    if (!await chrome.permissions.contains({ origins: [config.serverUrl + '/*'] })) throw new Error('서버 주소의 사이트 접근을 허용하세요.');
    await chrome.storage.local.set({ [SERVER_CONFIG]: config });
    return { server: NSCServer.publicConfig(config) };
  }
  if (!stored) throw new Error('서버 주소와 토큰을 먼저 저장하세요.');
  const config = NSCServer.connection(stored);
  if (!await chrome.permissions.contains({ origins: [config.serverUrl + '/*'] })) throw new Error('서버 주소의 사이트 접근을 허용하세요.');
  return { ...await NSCServer.check(config), server: NSCServer.publicConfig(config) };
}
async function serverApi(path, body) {
  await serverStorageReady;
  if (serverStorageError) throw new Error('토큰 저장 보호 설정을 확인하세요.');
  const config = (await chrome.storage.local.get([SERVER_CONFIG]))[SERVER_CONFIG];
  if (!config) throw new Error('서버 주소와 토큰을 먼저 저장하세요.');
  if (!await chrome.permissions.contains({ origins: [config.serverUrl + '/*'] })) throw new Error('서버 사이트 접근을 허용하세요.');
  return NSCServer.api(config, path, body);
}
async function uploadServerResult(job, finishedStatus = 'completed') {
  const { items } = await read();
  job.server.uploadPending = true; await save({ job });
  try {
    const result = await serverApi('/results', { taskId: job.server.taskId, items });
    job.server.uploaded = true; job.server.uploadPending = false;
    const saved = `서버 저장 완료 · ${result.resultCount}건` + (typeof result.changedCount === 'number' ? ` · 변경 ${result.changedCount}건` : '');
    if (job.server.autoNext) {
      const settings = normalizeSettings(job.settings);
      const seconds = randomSeconds(settings.keywordMin, settings.keywordMax);
      job.status = 'running'; job.phase = 'keyword-wait';
      job.nextActionAt = Date.now() + seconds * 1000;
      job.documentId = null; job.token = crypto.randomUUID();
      job.message = `${saved} · 다음 서버 키워드까지 ${seconds}초 대기`;
      log(job, job.message); await save({ job });
      await chrome.alarms.clear(WATCH);
      await chrome.alarms.create(NEXT, { when: job.nextActionAt });
      return { uploaded: true, message: job.message };
    }
    job.status = finishedStatus; job.phase = 'done'; job.nextActionAt = null;
    job.message = saved; log(job, job.message); await save({ job });
    return { uploaded: true, message: job.message };
  } catch (error) {
    await halt(job, error.message + ' 로컬 결과는 보관됩니다. 업로드 재시도를 눌러주세요.', finishedStatus === 'stopped' ? 'stopped' : 'paused');
    return { uploaded: false, message: job.message };
  }
}
function log(job, message) { job.logs = [...(job.logs || []), { at: Date.now(), message }].slice(-150); }
async function halt(job, message, status = 'paused') {
  job.resumePhase = job.phase;
  job.remainingWait = Math.max(0, (job.nextActionAt || 0) - Date.now());
  job.status = status; job.message = message; job.nextActionAt = null; job.token = crypto.randomUUID();
  log(job, message);
  await save({ job }); await chrome.alarms.clear(NEXT); await chrome.alarms.clear(WATCH); await chrome.alarms.clear(CHECK);
}
async function checkLanding(job) {
  if (!job || job.status !== 'running' || job.phase === 'keyword-wait' || job.phase === 'done') return;
  let tab;
  try { tab = await chrome.tabs.get(job.tabId); }
  catch { return halt(job, '검색 탭이 닫혔습니다. 재개하면 새 탭에서 이어갑니다.'); }
  const url = tab.pendingUrl || tab.url;
  if (url && url !== 'about:blank' && !matchesPage(url, job)) {
    let where = url; try { const u = new URL(url); where = u.host + u.pathname; } catch { /* keep full URL */ }
    return halt(job, `검색 페이지가 예상 주소와 다릅니다(${where}). 로그인·접근 제한·리다이렉트를 확인한 후 재개하세요.`);
  }
  // A content script that talks to us flips phase away from 'loading' via READY.
  if (job.phase !== 'loading') return;
  job.checks = (job.checks || 0) + 1;
  if (job.checks > 5) return halt(job, '검색 탭은 열렸지만 수집 스크립트가 응답하지 않습니다. 확장 프로그램 사이트 접근 권한과 새로고침 상태를 확인한 후 재개하세요.');
  if (tab.status === 'loading') { await save({ job }); return void chrome.alarms.create(CHECK, { when: Date.now() + 12000 }); }
  if (!job.reinjected) {
    job.reinjected = true;
    try {
      await chrome.scripting.executeScript({ target: { tabId: job.tabId }, files: ['core.js', 'extractor.js', 'content.js'] });
      job.message = '수집 스크립트를 다시 넣고 연결을 확인하는 중';
    } catch (error) {
      return halt(job, `검색 탭에 수집 스크립트를 넣지 못했습니다(${error.message}). 확장 프로그램의 사이트 접근 권한을 확인한 후 재개하세요.`);
    }
    log(job, job.message);
  }
  await save({ job });
  await chrome.alarms.create(CHECK, { when: Date.now() + 12000 });
}
async function navigate(job) {
  job.phase = 'loading'; job.documentId = null; job.token = crypto.randomUUID(); job.nextActionAt = null;
  job.checks = 0; job.reinjected = false;
  job.lastHeartbeat = Date.now(); job.message = `${job.keywords[job.keywordIndex]} · ${job.page}페이지 여는 중`;
  log(job, job.message); await save({ job });
  try { await chrome.tabs.get(job.tabId); }
  catch {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true, ...(Number.isInteger(job.windowId) ? { windowId: job.windowId } : {}) });
    job.tabId = tab.id; await save({ job });
  }
  await chrome.alarms.create(WATCH, { periodInMinutes: 1 });
  await chrome.tabs.update(job.tabId, { url: searchUrl(job.keywords[job.keywordIndex], job.page, job.settings) });
  // A redirect (login/block page) never runs the content script, so check the landing URL.
  await chrome.alarms.create(CHECK, { when: Date.now() + 12000 });
}
async function nextKeyword(job) {
  job.keywordIndex += 1; job.page = 1; job.scrolls = 0;
  await navigate(job);
}
async function nextServerTask(job) {
  let tasks;
  try { ({ tasks } = await serverApi('/tasks?limit=1&take=1')); }
  catch (error) { await halt(job, `다음 서버 키워드를 받지 못했습니다. ${error.message}`); return; }
  if (!tasks?.length) {
    job.status = 'completed'; job.phase = 'done'; job.finishedAt = Date.now(); job.nextActionAt = null;
    // Nothing left to fetch: a later manual retry must not restart the wait loop.
    job.server.autoNext = false;
    job.message = '대기 중인 서버 키워드가 없습니다. 수집을 마쳤습니다.'; log(job, job.message); await save({ job }); return;
  }
  const task = tasks[0];
  job.server = { taskId: task.id, autoNext: true };
  job.keywords = [task.keyword]; job.keywordIndex = 0; job.page = 1; job.scrolls = 0;
  job.completedPages = 0; job.count = 0;
  // Keep the previous task's results visible until the next keyword actually starts.
  await save({ job, items: [] });
  await navigate(job);
}
function trustedDashboard(sender) {
  if (sender.id !== chrome.runtime.id) return false;
  const base = chrome.runtime.getURL('dashboard.html');
  return sender.url === base || Boolean(sender.url && sender.url.startsWith(`${base}?`));
}
function openDashboardWindow() {
  return chrome.windows.create({ url: chrome.runtime.getURL('dashboard.html'), type: 'popup', width: 420, height: 840 }).catch(console.error);
}
const OVERLAY = 'nsc-layer';
async function probeOverlay(tabId) {
  const [probe] = await chrome.scripting.executeScript({ target: { tabId }, func: id => Boolean(document.getElementById(id)), args: [OVERLAY] });
  return Boolean(probe?.result);
}
async function ensureOverlay(tabId) {
  try {
    if (await probeOverlay(tabId)) return;
    await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay.js'] });
  } catch (error) { console.warn('레이어를 넣지 못했습니다:', error.message); }
}
async function toggleOverlay(tabId) {
  try {
    if (await probeOverlay(tabId)) {
      await chrome.scripting.executeScript({ target: { tabId }, func: id => document.getElementById(id)?.remove(), args: [OVERLAY] });
      return;
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay.js'] });
  } catch (error) {
    // chrome:// pages and strict CSP pages cannot host the layer.
    console.warn('레이어를 넣지 못해 창으로 엽니다:', error.message);
    await openDashboardWindow();
  }
}
async function handle(message, sender) {
  if (['GET_SERVER_CONFIG', 'SAVE_SERVER_CONFIG', 'CLEAR_SERVER_CONFIG', 'TEST_SERVER_CONNECTION'].includes(message.type)) return serverSettings(message, sender);
  if (message.type === 'OVERLAY_FAILED') { await openDashboardWindow(); return {}; }
  const { job, items } = await read();
  if (['SERVER_START', 'RETRY_SERVER_UPLOAD'].includes(message.type)) {
    if (!trustedDashboard(sender)) throw new Error('수집기 관리 화면에서 실행하세요.');
    if (message.type === 'RETRY_SERVER_UPLOAD') {
      const retryable = job?.server && items.length &&
        (job.server.uploadPending || ['stopped', 'completed'].includes(job.status) || job.phase === 'keyword-wait');
      if (!retryable) throw new Error('재전송할 서버 결과가 없습니다.');
      const result = await uploadServerResult(job, job.status === 'stopped' ? 'stopped' : 'completed');
      return { message: result.message, uploaded: result.uploaded };
    }
    if (job && ['running', 'paused'].includes(job.status)) throw new Error('현재 작업을 종료한 뒤 새 작업을 받으세요.');
    if (items.length && !job?.server?.uploaded) throw new Error('기존 결과를 다운로드하고 비운 뒤 시작하세요.');
    const settings = normalizeSettings(message.settings);
    const { tasks } = await serverApi('/tasks?limit=1&take=1');
    if (!tasks?.length) throw new Error('수집할 서버 키워드가 없습니다.');
    const task = tasks[0];
    const next = { id: crypto.randomUUID(), keywords: [task.keyword], settings, keywordIndex: 0, page: 1,
      status: 'running', phase: 'loading', windowId: message.windowId, startedAt: Date.now(), count: 0, completedPages: 0, scrolls: 0, logs: [], server: { taskId: task.id, autoNext: true } };
    await save({ job: next, items: [] }); await navigate(next); return {};
  }
  if (['GET', 'START', 'PAUSE', 'RESUME', 'STOP', 'CLEAR', 'RESET', 'FOCUS', 'OPEN_PREVIEW'].includes(message.type)) {
    if (!trustedDashboard(sender)) throw new Error('수집기 관리 화면에서 실행하세요.');
    if (message.type === 'GET') return { job, items };
    if (message.type === 'RESET') {
      await chrome.alarms.clear(NEXT); await chrome.alarms.clear(WATCH); await chrome.alarms.clear(CHECK);
      await save({ job: null, items: [] }); return {};
    }
    if (message.type === 'OPEN_PREVIEW') {
      if (job && ['running', 'paused'].includes(job.status)) throw new Error('현재 작업을 종료한 후 검색 화면만 열 수 있습니다.');
      const keyword = parseKeywords(message.keywords)[0];
      await chrome.tabs.create({ url: searchUrl(keyword, 1, normalizeSettings(message.settings)), active: true, ...(Number.isInteger(message.windowId) ? { windowId: message.windowId } : {}) });
      return {};
    }
    if (message.type === 'FOCUS') {
      if (!job?.tabId) throw new Error('열려 있는 수집 탭이 없습니다.');
      let tab;
      try { tab = await chrome.tabs.get(job.tabId); } catch { throw new Error('수집 탭이 닫혔습니다. 작업을 재개하면 다시 열립니다.'); }
      await chrome.tabs.update(tab.id, { active: true });
      if (Number.isInteger(tab.windowId)) await chrome.windows.update(tab.windowId, { focused: true });
      return {};
    }
    if (message.type === 'START') {
      if (job?.status === 'running' || job?.status === 'paused') throw new Error('현재 작업을 종료한 후 새 수집을 시작하세요.');
      if (items.length) throw new Error('기존 결과를 다운로드하고 결과 비우기를 눌러주세요.');
      const newJob = { id: crypto.randomUUID(), keywords: parseKeywords(message.keywords), settings: normalizeSettings(message.settings), keywordIndex: 0, page: 1,
        status: 'running', phase: 'loading', windowId: message.windowId, startedAt: Date.now(), count: 0, completedPages: 0, scrolls: 0, logs: [] };
      await save({ job: newJob, items: [] }); await navigate(newJob); return {};
    }
    if (message.type === 'CLEAR') {
      if (job && ['running', 'paused'].includes(job.status)) throw new Error('작업 종료 후 비울 수 있습니다.');
      await save({ job: null, items: [] }); return {};
    }
    if (!job) throw new Error('진행 중인 작업이 없습니다.');
    if (message.type === 'PAUSE' && job.status === 'running') await halt(job, '사용자가 일시정지했습니다.');
    if (message.type === 'STOP' && ['running', 'paused'].includes(job.status)) {
      const serverTask = job.server ? { ...job.server } : null;
      await halt(job, '작업을 종료했습니다. 수집 결과는 보관됩니다.', 'stopped');
      if (serverTask) {
        const stopped = (await read()).job;
        // A user stop ends the run: do not fetch the next keyword after this upload.
        stopped.server.autoNext = false;
        if (items.length && !serverTask.uploaded) {
          stopped.server.uploadPending = true;
          stopped.message = `종료 후 수집 결과 ${items.length}개를 서버로 전송합니다.`;
          log(stopped, stopped.message); await save({ job: stopped });
          await uploadServerResult(stopped, 'stopped');
        } else await save({ job: stopped });
      }
    }
    if (message.type === 'RESUME' && job.status === 'paused') {
      if (job.server?.uploadPending) { await uploadServerResult(job); return {}; }
      job.status = 'running';
      if (Number.isInteger(message.windowId)) job.windowId = message.windowId;
      if (job.resumePhase === 'keyword-wait') {
        job.phase = 'keyword-wait'; job.nextActionAt = Date.now() + Math.max(1000, job.remainingWait || 0);
        job.message = '다음 검색어 대기를 재개했습니다.'; await save({ job });
        await chrome.alarms.create(NEXT, { when: job.nextActionAt });
      } else await navigate(job);
    }
    return {};
  }
  if (!job || job.status !== 'running' || sender.tab?.id !== job.tabId) return { active: false, reason: !job || job.status !== 'running' ? 'idle' : 'tab' };
  // A previous document can report after navigation; never let it pause the new page.
  if (message.type !== 'READY' && (message.token !== job.token || sender.documentId !== job.documentId)) return { active: false };
  if (!matchesPage(sender.url || sender.tab.url, job)) {
    if (message.type === 'READY') {
      // Compare against the tab's *current* URL: a stale document must not pause the new page.
      try {
        const tab = await chrome.tabs.get(sender.tab.id);
        if (tab.url && tab.url === sender.url) {
          let where = tab.url; try { const u = new URL(tab.url); where = u.host + u.pathname; } catch { /* keep full URL */ }
          await halt(job, `검색 페이지가 예상 주소와 다릅니다(${where}). 로그인·접근 제한·리다이렉트를 확인하세요.`);
        }
      } catch { /* tab closed: let the watchdog handle it */ }
      return { active: false, reason: 'url' };
    }
    await halt(job, '검색 탭의 주소가 변경되었습니다. 재개하면 예정된 검색 페이지를 다시 엽니다.'); return { active: false };
  }
  if (message.type === 'READY') {
    if (job.phase !== 'loading') return { active: false, reason: 'phase' };
    job.documentId = sender.documentId; job.phase = 'collecting'; job.lastHeartbeat = Date.now();
    job.message = '상품을 읽고 있습니다.'; await save({ job });
    return { active: true, job };
  }
  job.lastHeartbeat = Date.now();
  if (message.type === 'ISSUE') { await halt(job, String(message.message).slice(0,500)); return { active: false }; }
  if (message.type === 'PROGRESS') {
    const incoming = (message.items || []).filter(v => v.keyword === job.keywords[job.keywordIndex] && v.page === job.page);
    const merged = mergeItems(items, incoming);
    job.count = merged.length; job.scrolls = message.scrolls; job.nextActionAt = message.nextActionAt || null;
    job.message = message.message; await save({ job, items: merged }); return { active: true };
  }
  if (message.type === 'HEARTBEAT') { await save({ job }); return { active: true }; }
  if (message.type === 'PAGE_DONE') {
    const settings = normalizeSettings(job.settings);
    job.completedPages++; job.scrolls = 0;
    log(job, `${job.keywords[job.keywordIndex]} · ${job.page}페이지 완료 (${message.count}개)`);
    if (job.page < settings.maxPages && message.hasNext) { job.page++; await navigate(job); }
    else if (job.keywordIndex + 1 < job.keywords.length) {
      const seconds = randomSeconds(settings.keywordMin, settings.keywordMax);
      job.phase = 'keyword-wait'; job.nextActionAt = Date.now() + seconds * 1000;
      job.message = `다음 검색어까지 ${seconds}초 대기`; job.documentId = null; job.token = crypto.randomUUID();
      log(job, job.message); await save({ job }); await chrome.alarms.clear(WATCH);
      await chrome.alarms.create(NEXT, { when: job.nextActionAt });
    } else {
      job.status = 'completed'; job.phase = 'done'; job.finishedAt = Date.now(); job.nextActionAt = null;
      if (job.server) job.server.uploadPending = true;
      job.message = `수집 완료 · ${job.count}개`; log(job, job.message); await save({ job }); await chrome.alarms.clear(WATCH);
      if (job.server) await uploadServerResult(job);
    }
    return { active: false };
  }
  return { active: false };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  serial(() => handle(message, sender)).then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});
// The toolbar icon toggles a floating dashboard layer on the current tab.
chrome.action.onClicked.addListener(tab => serial(async () => { if (Number.isInteger(tab.id)) await toggleOverlay(tab.id); }));
// Keep the layer visible on the search tab so controls and progress sit beside the page.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  serial(async () => {
    const { job } = await read();
    if (job?.status !== 'running' || job.tabId !== tabId) return;
    if (!matchesPage(tab.url, job)) return;
    await ensureOverlay(tabId);
  });
});
chrome.tabs.onRemoved.addListener(tabId => serial(async () => {
  const { job } = await read(); if (job?.tabId === tabId && job.status === 'running') await halt(job, '검색 탭이 닫혔습니다. 재개하면 새 탭에서 이어갑니다.');
}));
chrome.alarms.onAlarm.addListener(alarm => serial(async () => {
  const { job } = await read(); if (job?.status !== 'running') return;
  if (alarm.name === CHECK) return checkLanding(job);
  if (alarm.name === NEXT && job.phase === 'keyword-wait') {
    if (Date.now() < job.nextActionAt) await chrome.alarms.create(NEXT, { when: job.nextActionAt });
    else if (job.server?.autoNext) await nextServerTask(job);
    else await nextKeyword(job);
  }
  if (alarm.name === WATCH && job.phase !== 'keyword-wait' && Date.now() - job.lastHeartbeat > 60000) await halt(job, '검색 탭이 1분 동안 응답하지 않았습니다. 로그인·접근 제한·리다이렉트 여부를 확인한 후 재개하세요.');
}));
const recover = () => serial(async () => {
  const { job } = await read();
  if (job?.server?.uploadPending && !job.server.uploaded) await halt(job, '전송 결과 확인이 필요합니다. 업로드 재시도를 눌러주세요.');
  else if (job?.status === 'running') await halt(job, '브라우저 또는 확장 프로그램이 재시작되었습니다. 재개 버튼을 눌러주세요.');
});
chrome.runtime.onStartup.addListener(recover);
chrome.runtime.onInstalled.addListener(recover);
// Service-worker suspension must not lose a long keyword timer.
serial(async () => {
  const { job } = await read();
  if (job?.server?.uploadPending && !job.server.uploaded) await halt(job, '업로드 재시도를 눌러 서버에 결과를 저장하세요.');
  if (job?.status !== 'running') return;
  if (job.phase === 'keyword-wait' && !await chrome.alarms.get(NEXT)) await chrome.alarms.create(NEXT, { when: Math.max(Date.now() + 1000, job.nextActionAt) });
  else if (job.phase !== 'keyword-wait' && !await chrome.alarms.get(WATCH)) await chrome.alarms.create(WATCH, { periodInMinutes: 1 });
});
