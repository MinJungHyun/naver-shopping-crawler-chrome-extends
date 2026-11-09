importScripts('core.js');
const { parseKeywords, searchUrl, matchesPage, mergeItems, randomSeconds, timing } = NSC;
const NEXT = 'next-keyword', WATCH = 'collector-watchdog';
let queue = Promise.resolve();
const serial = fn => { const task = queue.then(fn); queue = task.catch(() => {}); return task; };
const read = async () => { const value = await chrome.storage.local.get(['job', 'items']); return { job: value.job || null, items: value.items || [] }; };
const save = value => chrome.storage.local.set(value);
function log(job, message) { job.logs = [...(job.logs || []), { at: Date.now(), message }].slice(-150); }
async function halt(job, message, status = 'paused') {
  job.resumePhase = job.phase;
  job.remainingWait = Math.max(0, (job.nextActionAt || 0) - Date.now());
  job.status = status; job.message = message; job.nextActionAt = null; job.token = crypto.randomUUID();
  log(job, message);
  await save({ job }); await chrome.alarms.clear(NEXT); await chrome.alarms.clear(WATCH);
}
async function navigate(job) {
  job.phase = 'loading'; job.documentId = null; job.token = crypto.randomUUID(); job.nextActionAt = null;
  job.lastHeartbeat = Date.now(); job.message = `${job.keywords[job.keywordIndex]} · ${job.page}페이지 여는 중`;
  log(job, job.message); await save({ job });
  try { await chrome.tabs.get(job.tabId); }
  catch {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
    job.tabId = tab.id; await save({ job });
  }
  await chrome.alarms.create(WATCH, { periodInMinutes: 1 });
  await chrome.tabs.update(job.tabId, { url: searchUrl(job.keywords[job.keywordIndex], job.page) });
}
async function nextKeyword(job) {
  job.keywordIndex += 1; job.page = 1; job.scrolls = 0;
  await navigate(job);
}
function trustedDashboard(sender) { return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('dashboard.html'); }
async function handle(message, sender) {
  const { job, items } = await read();
  if (['GET', 'START', 'PAUSE', 'RESUME', 'STOP', 'CLEAR'].includes(message.type)) {
    if (!trustedDashboard(sender)) throw new Error('수집기 관리 화면에서 실행하세요.');
    if (message.type === 'GET') return { job, items };
    if (message.type === 'START') {
      if (job?.status === 'running' || job?.status === 'paused') throw new Error('현재 작업을 종료한 후 새 수집을 시작하세요.');
      if (items.length) throw new Error('기존 결과를 다운로드하고 결과 비우기를 눌러주세요.');
      const newJob = { id: crypto.randomUUID(), keywords: parseKeywords(message.keywords), keywordIndex: 0, page: 1,
        status: 'running', phase: 'loading', startedAt: Date.now(), count: 0, completedPages: 0, scrolls: 0, logs: [] };
      await save({ job: newJob, items: [] }); await navigate(newJob); return {};
    }
    if (message.type === 'CLEAR') {
      if (job && ['running', 'paused'].includes(job.status)) throw new Error('작업 종료 후 비울 수 있습니다.');
      await save({ job: null, items: [] }); return {};
    }
    if (!job) throw new Error('진행 중인 작업이 없습니다.');
    if (message.type === 'PAUSE' && job.status === 'running') await halt(job, '사용자가 일시정지했습니다.');
    if (message.type === 'STOP' && ['running', 'paused'].includes(job.status)) await halt(job, '작업을 종료했습니다. 수집 결과는 보관됩니다.', 'stopped');
    if (message.type === 'RESUME' && job.status === 'paused') {
      job.status = 'running';
      if (job.resumePhase === 'keyword-wait') {
        job.phase = 'keyword-wait'; job.nextActionAt = Date.now() + Math.max(1000, job.remainingWait || 0);
        job.message = '다음 검색어 대기를 재개했습니다.'; await save({ job });
        await chrome.alarms.create(NEXT, { when: job.nextActionAt });
      } else await navigate(job);
    }
    return {};
  }
  if (!job || job.status !== 'running' || sender.tab?.id !== job.tabId) return { active: false };
  // A previous document can report after navigation; never let it pause the new page.
  if (message.type !== 'READY' && (message.token !== job.token || sender.documentId !== job.documentId)) return { active: false };
  if (!matchesPage(sender.url || sender.tab.url, job)) {
    if (message.type === 'READY') return { active: false };
    await halt(job, '검색 탭의 주소가 변경되었습니다. 재개하면 예정된 검색 페이지를 다시 엽니다.'); return { active: false };
  }
  if (message.type === 'READY') {
    if (job.phase !== 'loading') return { active: false };
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
    job.completedPages++; job.scrolls = 0;
    log(job, `${job.keywords[job.keywordIndex]} · ${job.page}페이지 완료 (${message.count}개)`);
    if (job.page === 1 && message.hasNext) { job.page = 2; await navigate(job); }
    else if (job.keywordIndex + 1 < job.keywords.length) {
      const seconds = randomSeconds(timing.keywordMin, timing.keywordMax);
      job.phase = 'keyword-wait'; job.nextActionAt = Date.now() + seconds * 1000;
      job.message = `다음 검색어까지 ${seconds}초 대기`; job.documentId = null; job.token = crypto.randomUUID();
      log(job, job.message); await save({ job }); await chrome.alarms.clear(WATCH);
      await chrome.alarms.create(NEXT, { when: job.nextActionAt });
    } else {
      job.status = 'completed'; job.phase = 'done'; job.finishedAt = Date.now(); job.nextActionAt = null;
      job.message = `수집 완료 · ${job.count}개`; log(job, job.message); await save({ job }); await chrome.alarms.clear(WATCH);
    }
    return { active: false };
  }
  return { active: false };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  serial(() => handle(message, sender)).then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }));
chrome.tabs.onRemoved.addListener(tabId => serial(async () => {
  const { job } = await read(); if (job?.tabId === tabId && job.status === 'running') await halt(job, '검색 탭이 닫혔습니다. 재개하면 새 탭에서 이어갑니다.');
}));
chrome.alarms.onAlarm.addListener(alarm => serial(async () => {
  const { job } = await read(); if (job?.status !== 'running') return;
  if (alarm.name === NEXT && job.phase === 'keyword-wait') {
    if (Date.now() < job.nextActionAt) await chrome.alarms.create(NEXT, { when: job.nextActionAt });
    else await nextKeyword(job);
  }
  if (alarm.name === WATCH && job.phase !== 'keyword-wait' && Date.now() - job.lastHeartbeat > 180000) await halt(job, '검색 탭이 3분 동안 응답하지 않았습니다. 탭을 확인한 후 재개하세요.');
}));
const recover = () => serial(async () => {
  const { job } = await read(); if (job?.status === 'running') await halt(job, '브라우저 또는 확장 프로그램이 재시작되었습니다. 재개 버튼을 눌러주세요.');
});
chrome.runtime.onStartup.addListener(recover);
chrome.runtime.onInstalled.addListener(recover);
// Service-worker suspension must not lose a long keyword timer.
serial(async () => {
  const { job } = await read();
  if (job?.status !== 'running') return;
  if (job.phase === 'keyword-wait' && !await chrome.alarms.get(NEXT)) await chrome.alarms.create(NEXT, { when: Math.max(Date.now() + 1000, job.nextActionAt) });
  else if (job.phase !== 'keyword-wait' && !await chrome.alarms.get(WATCH)) await chrome.alarms.create(WATCH, { periodInMinutes: 1 });
});
