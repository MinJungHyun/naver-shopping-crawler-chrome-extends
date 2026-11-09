const $ = id => document.getElementById(id);
const demoMode = new URLSearchParams(location.search).get('demo') === '1';
const extensionMode = !demoMode && location.protocol === 'chrome-extension:' && Boolean(globalThis.chrome?.runtime?.id);
let state = { job: null, items: [] }, busy = false;
const statusNames = { running: '수집 중', paused: '일시정지', completed: '완료', stopped: '종료' };
function showError(error) { $('error').textContent = error?.message || String(error); $('error').hidden = false; }
async function request(type, data = {}) {
  if (demoMode) {
    if (window.parent !== window) window.parent.postMessage({ type: 'NSC_DEMO_ACTION', action: type, ...data }, location.origin);
    return { ok: true };
  }
  const result = await chrome.runtime.sendMessage({ type, ...data });
  if (!result?.ok) throw new Error(result?.error || '확장 프로그램 연결을 확인하세요.');
  return result;
}
async function refresh() {
  if (!extensionMode) return render();
  try { state = await request('GET'); render(); } catch (error) { showError(error); }
}
function validateInput() {
  try { const words = NSC.parseKeywords($('keywords').value); $('keyword-count').textContent = `${words.length}개`; $('input-hint').hidden = true; return words; }
  catch (error) { $('keyword-count').textContent = '—'; $('input-hint').hidden = false; $('input-hint').textContent = '문자열 배열을 확인하세요.'; throw error; }
}
const settingControls = [...document.querySelectorAll('[data-setting]')];
function fillOptions(id, values, label) {
  $(id).replaceChildren(...values.map(value => { const option = document.createElement('option'); option.value = String(value); option.textContent = label(value); return option; }));
}
fillOptions('max-pages', Array.from({ length: 10 }, (_, i) => i + 1), n => n === 1 ? '1페이지' : `1~${n}페이지`);
for (const id of ['action-min', 'action-max']) fillOptions(id, Array.from({ length: 60 }, (_, i) => (i + 1) * 5), n => n % 60 ? `${n}초` : `${n / 60}분`);
for (const id of ['keyword-min', 'keyword-max']) fillOptions(id, Array.from({ length: 20 }, (_, i) => (i + 1) * 60), n => `${n / 60}분`);
function readSettings() { return NSC.normalizeSettings(Object.fromEntries(settingControls.map(control => [control.dataset.setting, Number(control.value)]))); }
function writeSettings(settings) {
  const value = NSC.normalizeSettings(settings);
  for (const control of settingControls) {
    const selected = String(value[control.dataset.setting]);
    if (![...control.options].some(option => option.value === selected)) {
      const option = document.createElement('option'); option.value = selected; option.textContent = NSC.timeLabel(Number(selected)); control.append(option);
    }
    control.value = selected;
  }
}
writeSettings();
for (const control of settingControls) control.addEventListener('change', () => {
  for (const prefix of ['action', 'keyword']) {
    const min = $(`${prefix}-min`), max = $(`${prefix}-max`);
    if (Number(min.value) > Number(max.value)) (control === min ? max : min).value = control.value;
  }
  if (extensionMode) chrome.storage.local.set({ draftSettings: readSettings() }).catch(showError);
  if (demoMode) {
    try { request('CONFIG', { settings: readSettings(), keywords: NSC.parseKeywords($('keywords').value) }); } catch { /* Validate the array when starting. */ }
  }
});
let displayedJobId = null;
function render() {
  const { job, items } = state, running = job?.status === 'running', paused = job?.status === 'paused';
  const settings = NSC.normalizeSettings(job?.settings);
  if (job && job.id !== displayedJobId) { writeSettings(settings); displayedJobId = job.id; }
  if (!job) displayedJobId = null;
  $('status').textContent = statusNames[job?.status] || '준비'; $('status').dataset.status = job?.status || '';
  $('count').replaceChildren(document.createTextNode(String(items.length)), Object.assign(document.createElement('small'), { textContent: '개' }));
  $('current').textContent = job ? job.keywords[job.keywordIndex] : '—';
  $('page').textContent = job ? `${job.page}/${settings.maxPages}p` : '—';
  $('current').title = job ? job.keywords[job.keywordIndex] : '현재 검색어';
  $('message').textContent = job?.message || '실행 대기'; $('message').title = $('message').textContent;
  $('progress').style.width = job ? `${job.status === 'completed' ? 100 : Math.min(99, (job.keywordIndex + (job.phase === 'keyword-wait' ? 1 : (job.page - 1) / settings.maxPages)) / job.keywords.length * 100)}%` : '0%';
  $('start').disabled = !(extensionMode || demoMode && window.parent !== window) || busy || running || paused || items.length > 0;
  $('open-preview').disabled = !extensionMode || busy || running || paused;
  $('pause').disabled = busy || !running; $('resume').disabled = busy || !paused; $('stop').disabled = busy || !(running || paused);
  $('keywords').disabled = running || paused;
  for (const control of settingControls) control.disabled = running || paused;
  $('csv').disabled = $('json').disabled = demoMode || items.length === 0;
  $('clear').disabled = !(extensionMode || demoMode) || busy || running || paused || (!job && !items.length);
  $('focus').disabled = demoMode || !extensionMode || busy || !job?.tabId;
  const phases = { loading: '검색 페이지 여는 중', collecting: '상품 확인 · 스크롤', 'keyword-wait': '다음 검색어 대기', done: '탐색 완료' };
  $('status').title = job?.status === 'paused' ? '일시정지됨' : phases[job?.phase] || '실행 대기';
  $('scrolls').textContent = `스크롤 ${job?.scrolls || 0}회`;
  $('result-count').textContent = `${items.length}개`;
  const query = $('filter').value.trim().toLowerCase();
  const matched = items.filter(v => [v.productName, v.sellerName, v.keyword, ...(v.sellers || []).map(s => s.name)].join(' ').toLowerCase().includes(query));
  const visible = matched.slice(-200).reverse(); $('visible-count').textContent = `${matched.length}개 중 ${visible.length}개 표시`;
  $('empty').hidden = visible.length > 0;
  $('empty').querySelector('strong').textContent = items.length ? '조건에 맞는 상품이 없습니다.' : '수집한 상품이 없습니다.';
  $('empty').querySelector('p').textContent = items.length ? '필터를 바꿔보세요.' : '결과가 여기에 표시됩니다.';
  $('rows').replaceChildren(...visible.map(row));
  $('log-count').textContent = job?.logs?.length || 0;
  const logs = (job?.logs || []).slice().reverse().map(entry => {
    const li = document.createElement('li'), time = document.createElement('time');
    time.textContent = new Date(entry.at).toLocaleTimeString('ko-KR'); li.append(time, document.createTextNode(entry.message)); return li;
  });
  $('logs').replaceChildren(...(logs.length ? logs : [Object.assign(document.createElement('li'), { textContent: '실행 기록이 없습니다.' })]));
  updateCountdown();
}
function safeUrl(value) { if (!value) return ''; try { const u = new URL(value, location.href); return /^https?:$/.test(u.protocol) || demoMode && u.origin === location.origin ? u.href : ''; } catch { return ''; } }
function row(item) {
  const tr = document.createElement('tr');
  const cell = () => { const td = document.createElement('td'); tr.append(td); return td; };
  const productCell = cell(), product = document.createElement('div'); product.className = 'product';
  const imageUrl = safeUrl(item.imageUrl);
  if (imageUrl) { const img = document.createElement('img'); img.src = imageUrl; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; product.append(img); }
  else { const placeholder = document.createElement('div'); placeholder.className = 'thumb-placeholder'; product.append(placeholder); }
  const copy = document.createElement('div'), link = document.createElement(safeUrl(item.productUrl) ? 'a' : 'span');
  link.textContent = item.productName;
  if (link.tagName === 'A') { link.href = safeUrl(item.productUrl); link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  copy.append(link); if (item.isAd) { const ad = document.createElement('span'); ad.className = 'ad'; ad.textContent = '광고'; copy.append(ad); }
  const id = document.createElement('small'); id.textContent = item.productId || ''; copy.append(id); product.append(copy); productCell.append(product);
  cell().textContent = item.sellerName || (item.sellers?.length ? `가격비교 · ${item.sellers.length}개 판매처` : '미표시');
  const price = cell(); price.className = 'price'; price.textContent = item.price == null ? '미표시' : `${item.price.toLocaleString('ko-KR')}원`;
  if (item.couponPrice != null) { const coupon = document.createElement('small'); coupon.textContent = `쿠폰 ${item.couponPrice.toLocaleString('ko-KR')}원`; price.append(coupon); }
  const source = cell(); source.textContent = item.keyword; const page = document.createElement('small'); page.textContent = `${item.page}페이지 · ${item.rank}번째`; source.append(page); return tr;
}
function updateCountdown() {
  const remaining = state.job?.status === 'running' && state.job.nextActionAt ? Math.max(0, Math.ceil((state.job.nextActionAt - Date.now()) / 1000)) : 0;
  const seconds = demoMode ? state.demoRemainingSeconds || 0 : remaining;
  $('countdown').textContent = seconds ? `${demoMode ? '예시 ' : ''}${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초` : '';
}
async function action(type) {
  if (busy) return; busy = true; $('error').hidden = true;
  try {
    const keywords = ['START', 'OPEN_PREVIEW'].includes(type) ? validateInput() : undefined;
    const settings = type === 'START' ? readSettings() : undefined;
    const windowId = extensionMode && ['START', 'RESUME', 'OPEN_PREVIEW'].includes(type) ? (await chrome.windows.getCurrent()).id : undefined;
    render(); await request(type, { keywords, settings, windowId }); await refresh();
  } catch (error) { showError(error); }
  finally { busy = false; render(); }
}
for (const type of ['START', 'PAUSE', 'RESUME', 'STOP']) $(type.toLowerCase()).addEventListener('click', () => action(type));
$('focus').addEventListener('click', () => action('FOCUS'));
$('open-preview').addEventListener('click', () => action('OPEN_PREVIEW'));
let clearArmed = false;
$('clear').addEventListener('click', async () => {
  if (!clearArmed) { clearArmed = true; $('clear').textContent = '비울까요?'; setTimeout(() => { clearArmed = false; $('clear').textContent = '비우기'; }, 5000); return; }
  clearArmed = false; $('clear').textContent = '비우기'; await action('CLEAR');
});
$('filter').addEventListener('input', render);
$('keywords').addEventListener('input', () => { try { validateInput(); } catch { /* inline hint */ } if (extensionMode) chrome.storage.local.set({ draft: $('keywords').value }).catch(showError); });
function download(format) {
  const payload = format === 'csv' ? NSC.toCsv(state.items) : JSON.stringify({ exportedAt: new Date().toISOString(), job: state.job, items: state.items }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `naver-shopping-${new Date().toISOString().replace(/[:.]/g, '-')}.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
$('csv').addEventListener('click', () => download('csv')); $('json').addEventListener('click', () => download('json'));
if (demoMode) {
  document.body.classList.add('demo-mode');
  $('preview').hidden = false;
  $('preview').textContent = '데모 · 예시 데이터 / 실제 수집·저장 없음';
  $('start-label').textContent = '데모 재생'; $('start').setAttribute('aria-label', '데모 재생'); $('start').title = '데모 재생';
  document.querySelector('.local').textContent = '데모';
  $('keywords').value = JSON.stringify(['플래티넘 사료', '강아지 간식'], null, 2);
  validateInput();
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'NSC_DEMO_STATE') return;
    const next = event.data.state;
    if (!next || !Array.isArray(next.items) || next.job && !Array.isArray(next.job.keywords)) return;
    state = next; render();
  });
  if (window.parent !== window) window.parent.postMessage({ type: 'NSC_DEMO_READY' }, location.origin);
} else if (extensionMode) {
  $('guide-link').href = 'help.html';
  chrome.storage.local.get(['draft', 'draftSettings', 'job']).then(value => {
    if (value.job) $('keywords').value = JSON.stringify(value.job.keywords, null, 2); else if (value.draft) $('keywords').value = value.draft;
    writeSettings(value.job?.settings || value.draftSettings); try { validateInput(); } catch {}
  }).catch(showError);
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.job || changes.items)) refresh(); });
} else $('preview').hidden = false;
setInterval(updateCountdown, 1000);
refresh();
