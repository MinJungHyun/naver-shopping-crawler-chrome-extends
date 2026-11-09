/* Synthetic examples only. This module has no Chrome APIs, storage or network requests. */
(function (root) {
  const core = typeof module !== 'undefined' ? require('./core') : root.NSC;
  function createDemo(keywords = ['플래티넘 사료', '강아지 간식'], input) {
    const settings = core.normalizeSettings(input);
    const actionRange = `${core.timeLabel(settings.actionMin)}~${core.timeLabel(settings.actionMax)}`;
    const keywordRange = `${core.timeLabel(settings.keywordMin)}~${core.timeLabel(settings.keywordMax)}`;
    const bounded = (n, min, max) => Math.min(max, Math.max(min, n));
    const steps = [{ phase: 'idle', keywordIndex: 0, page: 1, scrolls: 0, count: 0, message: '데모를 재생하거나 한 단계씩 살펴보세요.', stage: '준비' }];
    const products = [];
    let count = 0;
    keywords.forEach((keyword, keywordIndex) => {
      const step = values => steps.push({ keywordIndex, page: 1, scrolls: 0, count, ...values });
      step({ phase: 'loading', message: `${keyword} · 검색 1페이지 열기`, stage: '검색 페이지 열기' });
      for (let page = 1; page <= settings.maxPages; page++) {
        if (page > 1) step({ page, phase: 'loading', message: `${keyword} · 검색 ${page}페이지 열기`, stage: '다음 페이지로 이동' });
        for (let rank = 1; rank <= 6; rank++) {
          const price = [24900, 39600, 119200, 4900, 126600, 28900][rank - 1];
          products.push({ keyword, page, rank, productId: `demo-${keywordIndex}-${page}-${rank}`,
            productName: `${keyword} ${['데일리', '소프트', '프리미엄', '밸런스', '오리지널', '라이트'][rank - 1]} 상품 · 예시`,
            imageUrl: 'demo-product.svg', sellerName: ['예시 공식몰', '예시 펫스토어', '예시 마켓'][rank % 3],
            price, couponPrice: rank % 2 ? price - 1000 : null,
            productUrl: '', sellerUrl: '', isAd: rank === 1, productType: 'single', sellers: [], collectedAt: '2026-11-09T00:00:00.000Z' });
        }
        count += 3;
        step({ page, phase: 'collecting', count, message: '화면에 표시된 상품명·가격·업체명 확인', stage: '상품 정보 확인', highlight: [1, 2, 3] });
        const scrollWait = bounded(40, settings.actionMin, settings.actionMax);
        step({ page, phase: 'collecting', count, waitSeconds: scrollWait, message: `다음 스크롤 · 예시 ${core.timeLabel(scrollWait)} 대기 (설정 ${actionRange})`, stage: '스크롤 전 무작위 대기' });
        count += 3;
        step({ page, phase: 'collecting', count, scrolls: 1, message: `화면 ${settings.scrollPercent}% 스크롤 → 새 상품·이미지 확인`, stage: '스크롤 · 지연 로딩 확인', highlight: [4, 5, 6] });
        if (page < settings.maxPages) {
          const pageWait = bounded(25, settings.actionMin, settings.actionMax);
          step({ page, phase: 'collecting', count, scrolls: 1, waitSeconds: pageWait, message: `${page + 1}페이지 이동 전 · 예시 ${core.timeLabel(pageWait)} 대기 (설정 ${actionRange})`, stage: '페이지 이동 전 무작위 대기' });
        }
      }
      if (keywordIndex + 1 < keywords.length) {
        const wait = bounded(240, settings.keywordMin, settings.keywordMax);
        step({ page: settings.maxPages, phase: 'keyword-wait', count, scrolls: 1, waitSeconds: wait, message: `다음 검색어 · 예시 ${core.timeLabel(wait)} 대기 (설정 ${keywordRange})`, stage: '다음 검색어 대기' });
      }
    });
    steps.push({ phase: 'done', keywordIndex: keywords.length - 1, page: settings.maxPages, scrolls: 1, count, message: '데모 완료 · 실제 수집·저장한 상품은 없습니다.', stage: '탐색 완료' });
    return { keywords, settings, steps, products };
  }
  function stateAt(model, index, status = 'running', remaining) {
    const step = model.steps[index], items = model.products.slice(0, step.count);
    if (index === 0) return { job: null, items: [], demoRemainingSeconds: 0 };
    return { job: { id: 'demo', settings: model.settings, keywords: model.keywords, keywordIndex: step.keywordIndex, page: step.page,
      status: step.phase === 'done' ? 'completed' : status, phase: step.phase, scrolls: step.scrolls, count: items.length,
      message: step.phase === 'done' ? step.message : status === 'paused' ? `데모 일시정지 · ${step.message}` : status === 'stopped' ? '데모를 종료했습니다. 다시 보려면 처음으로를 누르세요.' : step.message,
      logs: model.steps.slice(1, index + 1).map((v, i) => ({ at: 1794186000000 + i * 1000, message: v.message })) },
      items, demoRemainingSeconds: remaining ?? step.waitSeconds ?? 0 };
  }
  root.NSCDemo = { createDemo, stateAt };
  if (typeof module !== 'undefined') module.exports = root.NSCDemo;
})(globalThis);
