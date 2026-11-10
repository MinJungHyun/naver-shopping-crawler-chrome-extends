/* Page timers run in the content script, independent of service-worker idle shutdown. */
(async function () {
  // The service worker can wake up or be replaced while this page loads, so retry the handshake.
  let ready = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    ready = await chrome.runtime.sendMessage({ type: 'READY' }).catch(() => null);
    if (ready && (ready.active || ready.reason === 'idle')) break;
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready?.active) return;
  const job = ready.job, token = job.token;
  const settings = NSC.normalizeSettings(job.settings);
  const context = { keyword: job.keywords[job.keywordIndex], page: job.page, sourceUrl: location.href };
  let scrolls = 0, pageItems = [], active = true;
  const badge = (() => {
    try {
      if (typeof document.createElement !== 'function' || typeof document.documentElement?.append !== 'function') return null;
      const el = document.createElement('div');
      el.id = 'nsc-status-badge';
      Object.assign(el.style, {
        position: 'fixed', left: '16px', bottom: '16px', zIndex: '2147483647',
        background: '#079b66', color: '#fff', font: '600 12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        padding: '8px 12px', borderRadius: '8px', boxShadow: '0 4px 14px #0003', maxWidth: '340px', pointerEvents: 'none'
      });
      el.textContent = `수집기 · ${context.keyword} ${context.page}페이지`;
      document.documentElement.append(el);
      return el;
    } catch { return null; }
  })();
  const setBadge = (text, tone = 'run') => {
    if (!badge) return;
    badge.textContent = `수집기 · ${text}`;
    badge.style.background = tone === 'stop' ? '#c0392b' : tone === 'wait' ? '#8a6d1f' : '#079b66';
  };
  const send = async (type, data = {}) => {
    const reply = await chrome.runtime.sendMessage({ type, token, ...data });
    if (!reply.ok) throw new Error(reply.error);
    if (!reply.active) { active = false; setBadge('일시정지됨 · 레이어 확인', 'stop'); }
    return reply;
  };
  async function sleep(ms, label = '') {
    const end = Date.now() + ms;
    while (active && Date.now() < end) {
      if (label) setBadge(`${label} · ${Math.ceil((end - Date.now()) / 1000)}초`, 'wait');
      await new Promise(resolve => setTimeout(resolve, Math.min(5000, end - Date.now())));
      await send('HEARTBEAT');
    }
    return active;
  }
  function collect() { pageItems = NSC.mergeItems(pageItems, NSCExtractor.extractProducts(document, context)); }
  async function progress(message, nextActionAt = null) {
    collect(); setBadge(message); await send('PROGRESS', { items: pageItems, scrolls, message, nextActionAt });
  }
  async function waitAction(message) {
    const seconds = NSC.randomSeconds(settings.actionMin, settings.actionMax);
    await progress(`${message} · ${seconds}초 대기`, Date.now() + seconds * 1000);
    return active && await sleep(seconds * 1000, message);
  }
  const jitter = (min, max) => min + Math.random() * (max - min);
  // Move the page's pointer a few times so the page sees a pointer that drifts like a hand.
  // The real OS cursor does not move: these are synthetic events (isTrusted === false).
  let pointer = null;
  const pointerSupported = () => typeof MouseEvent === 'function' && typeof document.elementFromPoint === 'function';
  function dispatchMove(x, y) {
    let target = null;
    try { target = document.elementFromPoint(x, y); } catch { /* fall back to the document */ }
    target = target || document.documentElement || document;
    if (typeof target.dispatchEvent !== 'function') return;
    const init = { clientX: x, clientY: y, screenX: x, screenY: y, bubbles: true, cancelable: true, view: window, buttons: 0 };
    target.dispatchEvent(new MouseEvent('mousemove', init));
    if (typeof PointerEvent === 'function') target.dispatchEvent(new PointerEvent('pointermove', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  }
  async function humanMotion(steps) {
    if (document.visibilityState === 'hidden' || !pointerSupported()) return active;
    const width = window.innerWidth || 1200, height = window.innerHeight || 800;
    const left = Math.min(80, width * 0.08), right = Math.max(left + 60, Math.min(width * 0.62, width - 400));
    const top = height * 0.18, bottom = height * 0.82;
    const from = pointer || { x: jitter(left, right), y: jitter(top, bottom) };
    const to = { x: jitter(left, right), y: jitter(top, bottom) };
    const bend = { x: jitter(-45, 45), y: jitter(-45, 45) };
    for (let i = 1; i <= steps && active; i++) {
      if (document.visibilityState === 'hidden') break;
      const t = i / steps, ease = t * t * (3 - 2 * t);
      const x = Math.round(from.x + (to.x - from.x) * ease + bend.x * Math.sin(Math.PI * t));
      const y = Math.round(from.y + (to.y - from.y) * ease + bend.y * Math.sin(Math.PI * t));
      dispatchMove(x, y);
      pointer = { x, y };
      await new Promise(resolve => setTimeout(resolve, jitter(28, 80)));
    }
    return active;
  }
  // One "드르륵": ease in and out instead of teleporting down the page.
  async function glide(distance, duration) {
    if (document.visibilityState === 'hidden') { window.scrollBy({ top: distance, behavior: 'instant' }); return; }
    const start = Date.now();
    let moved = 0;
    while (active) {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = distance * (1 - Math.cos(Math.PI * t)) / 2;
      const delta = Math.round(eased - moved);
      if (delta) { window.scrollBy({ top: delta, behavior: 'instant' }); moved += delta; }
      if (t >= 1) return;
      // A hidden tab throttles timers; finish the move at once instead of crawling.
      if (document.visibilityState === 'hidden') break;
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    if (active && moved !== Math.round(distance)) window.scrollBy({ top: Math.round(distance) - moved, behavior: 'instant' });
  }
  // People scroll in uneven flicks: some short and quick, some long and slow,
  // and now and then a small glance back up before carrying on.
  async function humanScroll() {
    const total = Math.max(1, Math.floor(window.innerHeight * settings.scrollPercent / 100));
    const up = window.scrollY > 320 && Math.random() < 0.3 ? Math.round(jitter(80, Math.min(220, total * 0.45))) : 0;
    const downTotal = total + up;
    const flicks = 2 + Math.floor(Math.random() * 3);
    const weights = Array.from({ length: flicks }, () => jitter(0.55, 1.6));
    const sum = weights.reduce((a, b) => a + b, 0);
    const downs = weights.map(weight => Math.max(40, Math.round(downTotal * weight / sum)));
    downs[downs.length - 1] = Math.max(40, downs[downs.length - 1] + downTotal - downs.reduce((a, b) => a + b, 0));
    const moves = downs.map(distance => ({ distance }));
    if (up) moves.splice(1 + Math.floor(Math.random() * (moves.length - 1)), 0, { distance: -up });
    for (let i = 0; i < moves.length && active; i++) {
      const { distance } = moves[i];
      setBadge(distance < 0 ? '잠깐 위로 · 드르륵' : `스크롤 ${i + 1}/${moves.length} · 드르륵`);
      if (!await humanMotion(i === 0 ? Math.round(jitter(4, 7)) : Math.round(jitter(1, 3)))) return false;
      // Short flicks finish quickly, long ones take longer, and both vary from run to run.
      await glide(distance, jitter(160, 320) + Math.abs(distance) * jitter(0.45, 1.05));
      if (i < moves.length - 1 && !await sleep(Math.round(jitter(220, 480) + Math.abs(distance) * jitter(0.4, 1.4)), '스크롤 후')) return false;
    }
    return active;
  }
  const noResults = () => /검색 결과가 없습니다|검색결과가 없습니다|검색된 상품이 없습니다/.test(document.body.innerText);
  const nextLink = () => [...document.querySelectorAll('[class*="pagination"] a, [class*="paginate"] a, [class*="pagination"] button')].find(a => a.textContent.trim() === String(job.page + 1));
  try {
    // Hydration can finish after document_idle. This only waits for data, it does not scroll.
    for (let retry = 0; retry < 15 && active; retry++) {
      const issue = NSCExtractor.pageIssue(document); if (issue) throw new Error(issue);
      collect(); if (pageItems.length || noResults()) break;
      if (!await sleep(2000)) return;
    }
    if (!active) return;
    if (!pageItems.length && !noResults()) throw new Error('상품 영역을 찾지 못했습니다. 화면 또는 DOM 구조를 확인하세요.');
    let bottomStable = 0, lastHeight = 0;
    await progress('상품 수집 중');
    while (active && !noResults()) {
      const issue = NSCExtractor.pageIssue(document); if (issue) throw new Error(issue);
      if (scrolls >= 150) throw new Error('스크롤 150회에 도달했습니다. 무한 로딩 여부를 확인하세요. 현재 결과는 저장되었습니다.');
      if (!await waitAction('다음 스크롤')) return;
      if (!await humanScroll()) return;
      scrolls++;
      // Give lazy images/products a short settling window before persisting.
      if (!await sleep(1500)) return;
      await progress('스크롤 후 상품 저장 중');
      const height = document.documentElement.scrollHeight;
      const atBottom = window.scrollY + window.innerHeight >= height - 5;
      bottomStable = atBottom && height === lastHeight ? bottomStable + 1 : 0;
      lastHeight = height;
      if (bottomStable >= 2) break;
    }
    if (!active) return;
    const issue = NSCExtractor.pageIssue(document); if (issue) throw new Error(issue);
    const hasNext = Boolean(nextLink());
    if (job.page < settings.maxPages && hasNext && !await waitAction(`${job.page + 1}페이지 이동 전`)) return;
    await progress('페이지 수집 완료');
    if (active) await send('PAGE_DONE', { count: pageItems.length, hasNext });
  } catch (error) {
    setBadge(`중지 · ${error.message}`, 'stop');
    if (active) await send('ISSUE', { message: error.message }).catch(() => {});
  }
})();
