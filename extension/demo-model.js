/* Synthetic examples only. This module has no Chrome APIs, storage or network requests. */
(function (root) {
  function createDemo(keywords = ['플래티넘 사료', '강아지 간식']) {
    const steps = [{ phase: 'idle', keywordIndex: 0, page: 1, scrolls: 0, count: 0, message: '데모를 재생하거나 한 단계씩 살펴보세요.', stage: '준비' }];
    const products = [];
    let count = 0;
    keywords.forEach((keyword, keywordIndex) => {
      const step = (values) => steps.push({ keywordIndex, page: 1, scrolls: 0, count, ...values });
      step({ phase: 'loading', message: `${keyword} · 검색 1페이지 열기`, stage: '검색 페이지 열기' });
      for (const page of [1, 2]) {
        if (page === 2) step({ page, phase: 'loading', message: `${keyword} · 검색 2페이지 열기`, stage: '2페이지로 이동' });
        for (let rank = 1; rank <= 6; rank++) {
          products.push({ keyword, page, rank, productId: `demo-${keywordIndex}-${page}-${rank}`,
            productName: `${keyword} ${['데일리', '소프트', '프리미엄', '밸런스', '오리지널', '라이트'][rank - 1]} 상품 · 예시`,
            imageUrl: 'demo-product.svg', sellerName: ['예시 공식몰', '예시 펫스토어', '예시 마켓'][rank % 3],
            price: [24900, 39600, 119200, 4900, 126600, 28900][rank - 1], couponPrice: rank % 2 ? [24900, 39600, 119200, 4900, 126600, 28900][rank - 1] - 1000 : null,
            productUrl: '', sellerUrl: '', isAd: rank === 1, productType: 'single', sellers: [], collectedAt: '2026-11-09T00:00:00.000Z' });
        }
        count += 3;
        step({ page, phase: 'collecting', count, message: '화면에 표시된 상품명·가격·업체명 확인', stage: '상품 정보 확인', highlight: [1, 2, 3] });
        step({ page, phase: 'collecting', count, waitSeconds: 40, message: '다음 스크롤 · 예시 40초 대기 (실제 10~70초)', stage: '스크롤 전 무작위 대기' });
        count += 3;
        step({ page, phase: 'collecting', count, scrolls: 1, message: '아래로 스크롤 → 새 상품·이미지 로딩 → 결과에 추가', stage: '스크롤 · 지연 로딩 확인', highlight: [4, 5, 6] });
        if (page === 1) step({ page, phase: 'collecting', count, scrolls: 1, waitSeconds: 25, message: '2페이지 이동 전 · 예시 25초 대기 (실제 10~70초)', stage: '페이지 이동 전 무작위 대기' });
      }
      if (keywordIndex + 1 < keywords.length) step({ page: 2, phase: 'keyword-wait', count, scrolls: 1, waitSeconds: 240, message: '다음 검색어 · 예시 4분 대기 (실제 3~10분)', stage: '다음 검색어 대기' });
    });
    steps.push({ phase: 'done', keywordIndex: keywords.length - 1, page: 2, scrolls: 1, count, message: '데모 완료 · 실제 수집·저장한 상품은 없습니다.', stage: '탐색 완료' });
    return { keywords, steps, products };
  }
  function stateAt(model, index, status = 'running', remaining) {
    const step = model.steps[index], items = model.products.slice(0, step.count);
    if (index === 0) return { job: null, items: [], demoRemainingSeconds: 0 };
    return { job: { id: 'demo', keywords: model.keywords, keywordIndex: step.keywordIndex, page: step.page,
      status: step.phase === 'done' ? 'completed' : status, phase: step.phase, scrolls: step.scrolls, count: items.length,
      message: step.phase === 'done' ? step.message : status === 'paused' ? `데모 일시정지 · ${step.message}` : status === 'stopped' ? '데모를 종료했습니다. 다시 보려면 처음으로를 누르세요.' : step.message,
      logs: model.steps.slice(1, index + 1).map((v, i) => ({ at: 1794186000000 + i * 1000, message: v.message })) },
      items, demoRemainingSeconds: remaining ?? step.waitSeconds ?? 0 };
  }
  root.NSCDemo = { createDemo, stateAt };
  if (typeof module !== 'undefined') module.exports = root.NSCDemo;
})(globalThis);
