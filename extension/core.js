/* Shared by the dashboard, service worker, content script and Node tests. */
(function (root) {
  const timing = Object.freeze({ actionMin: 10, actionMax: 70, keywordMin: 180, keywordMax: 600 });
  // One page of 80 in the 사료 category by default, so a run covers the same 80 products without turning pages.
  const defaultSettings = Object.freeze({ maxPages: 1, pagingSize: 80, catId: '50000155', scrollPercent: 85, ...timing });
  const pagingSizes = Object.freeze([40, 80]);
  function normalizeSettings(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('수집 설정을 확인하세요.');
    const value = { ...defaultSettings, ...input };
    const integer = (key, min, max) => {
      if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) throw new Error(`${key}: ${min}~${max} 범위의 정수를 선택하세요.`);
    };
    integer('maxPages', 1, 10);
    if (!pagingSizes.includes(value.pagingSize)) throw new Error('페이지당 상품 수를 선택하세요.');
    value.catId = value.catId == null ? '' : String(value.catId).trim();
    if (value.catId && !/^\d{1,12}$/.test(value.catId)) throw new Error('카테고리 ID는 12자리 이하 숫자로 입력하세요.');
    if (![50, 85, 100].includes(value.scrollPercent)) throw new Error('스크롤 이동량을 선택하세요.');
    integer('actionMin', 5, 300); integer('actionMax', 5, 300);
    integer('keywordMin', 60, 1200); integer('keywordMax', 60, 1200);
    if (value.actionMin > value.actionMax || value.keywordMin > value.keywordMax) throw new Error('최소 대기는 최대 대기보다 클 수 없습니다.');
    return Object.fromEntries(Object.keys(defaultSettings).map(key => [key, value[key]]));
  }
  function timeLabel(seconds) {
    const minutes = Math.floor(seconds / 60), rest = seconds % 60;
    return minutes ? `${minutes}분${rest ? ` ${rest}초` : ''}` : `${rest}초`;
  }
  function parseKeywords(input) {
    const values = typeof input === 'string' ? JSON.parse(input) : input;
    if (!Array.isArray(values) || !values.length || values.some(v => typeof v !== 'string' || !v.trim())) {
      throw new Error('비어 있지 않은 문자열 배열을 입력하세요. 예: ["플래티넘 사료", "강아지 간식"]');
    }
    return [...new Set(values.map(v => v.trim()))];
  }
  function randomSeconds(min, max, random = Math.random) { return min + Math.floor(random() * (max - min + 1)); }
  function searchUrl(keyword, page, settings = defaultSettings) {
    const value = settings && typeof settings === 'object' ? settings : defaultSettings;
    const pagingSize = pagingSizes.includes(value.pagingSize) ? value.pagingSize : defaultSettings.pagingSize;
    const catId = String(value.catId ?? '').trim();
    const params = { where: 'all', frm: 'NVSCTAB', query: keyword, pagingIndex: String(page), pagingSize: String(pagingSize), productSet: 'total', sort: 'rel', viewType: 'list' };
    if (catId) params.catId = catId;
    const url = new URL('https://search.shopping.naver.com/search/all');
    url.search = new URLSearchParams(params);
    return url.href;
  }
  function matchesPage(url, job) {
    try {
      const u = new URL(url);
      return u.origin === 'https://search.shopping.naver.com' && u.pathname === '/search/all' &&
        u.searchParams.get('query') === job.keywords[job.keywordIndex] && Number(u.searchParams.get('pagingIndex') || 1) === job.page;
    } catch { return false; }
  }
  function itemKey(item) { return JSON.stringify([item.keyword, item.page, item.productId || item.productUrl || item.productName, item.isAd]); }
  function mergeItems(oldItems, fresh) {
    const map = new Map(oldItems.map(v => [itemKey(v), v]));
    for (const v of fresh) {
      const key = itemKey(v), old = map.get(key);
      map.set(key, old ? { ...old, ...v, imageUrl: v.imageUrl || old.imageUrl, sellerName: v.sellerName || old.sellerName, sellers: v.sellers?.length ? v.sellers : old.sellers, rank: old.rank } : v);
    }
    return [...map.values()];
  }
  const columns = ['keyword', 'page', 'rank', 'productId', 'productName', 'imageUrl', 'sellerName', 'price', 'couponPrice', 'originalPrice', 'shipping', 'productUrl', 'sellerUrl', 'isAd', 'productType', 'sellers', 'collectedAt'];
  function toCsv(items) {
    const cell = value => {
      let s = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    return '\uFEFF' + [columns, ...items.map(v => columns.map(k => v[k]))].map(row => row.map(cell).join(',')).join('\r\n');
  }
  root.NSC = { timing, defaultSettings, pagingSizes, normalizeSettings, timeLabel, parseKeywords, randomSeconds, searchUrl, matchesPage, itemKey, mergeItems, columns, toCsv };
  if (typeof module !== 'undefined') module.exports = root.NSC;
})(globalThis);
