/* Page timers run in the content script, independent of service-worker idle shutdown. */
(async function () {
  const ready = await chrome.runtime.sendMessage({ type: 'READY' }).catch(() => null);
  if (!ready?.active) return;
  const job = ready.job, token = job.token;
  const settings = NSC.normalizeSettings(job.settings);
  const context = { keyword: job.keywords[job.keywordIndex], page: job.page, sourceUrl: location.href };
  let scrolls = 0, pageItems = [], active = true;
  const send = async (type, data = {}) => {
    const reply = await chrome.runtime.sendMessage({ type, token, ...data });
    if (!reply.ok) throw new Error(reply.error);
    if (!reply.active) active = false;
    return reply;
  };
  async function sleep(ms) {
    const end = Date.now() + ms;
    while (active && Date.now() < end) {
      await new Promise(resolve => setTimeout(resolve, Math.min(5000, end - Date.now())));
      await send('HEARTBEAT');
    }
    return active;
  }
  function collect() { pageItems = NSC.mergeItems(pageItems, NSCExtractor.extractProducts(document, context)); }
  async function progress(message, nextActionAt = null) {
    collect(); await send('PROGRESS', { items: pageItems, scrolls, message, nextActionAt });
  }
  async function waitAction(message) {
    const seconds = NSC.randomSeconds(settings.actionMin, settings.actionMax);
    await progress(`${message} · ${seconds}초 대기`, Date.now() + seconds * 1000);
    return active && await sleep(seconds * 1000);
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
      window.scrollBy({ top: Math.max(1, Math.floor(window.innerHeight * settings.scrollPercent / 100)), behavior: 'instant' });
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
    if (active) await send('ISSUE', { message: error.message }).catch(() => {});
  }
})();
