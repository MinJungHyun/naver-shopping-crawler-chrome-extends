(function (root) {
  const titleSelector = 'a[data-shp-area-id="title"], [class*="product_title__"] a, a[class*="basicList_link__"], a[class*="adProduct_link__"]';
  const cardSelector = '[class*="product_item__"], [class*="basicList_item__"], [class*="adProduct_item__"]';
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const text = (el, selector) => clean(el.querySelector(selector)?.textContent);
  const money = value => { const m = clean(value).match(/\d[\d,]*/); return m ? Number(m[0].replaceAll(',', '')) : null; };
  const absolute = (url, base) => { if (!url || url === '#') return ''; try { const u = new URL(url, base); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
  function extractProducts(doc, context) {
    const base = doc.location?.href || context.sourceUrl || 'https://search.shopping.naver.com/';
    const titles = [...doc.querySelectorAll(titleSelector)];
    const seen = new Set();
    return titles.flatMap((title, index) => {
      const card = title.closest(cardSelector) || title.closest('[class*="product_inner__"]');
      if (!card || seen.has(card)) return [];
      seen.add(card);
      const productName = clean(title.getAttribute('title') || title.textContent);
      if (!productName) return [];
      const productUrl = absolute(title.getAttribute('href'), base);
      const image = card.querySelector('[class*="img_area"] img, [class*="image"] img, [class*="thumbnail"] img, img');
      const seller = card.querySelector('a[class*="product_mall__"], a[class*="basicList_mall__"], a[class*="adProduct_mall__"]');
      const sellers = [...card.querySelectorAll('a[class*="product_mall_item__"]')].map(a => ({
        name: clean(a.getAttribute('title') || text(a, '[class*="mall_name__"]')),
        price: money(text(a, '[class*="price"]') || clean(a.textContent).match(/[\d,]+\s*$/)?.[0]),
        url: a.getAttribute('href') === '#' ? '' : absolute(a.getAttribute('href'), base)
      }));
      let params = {}; try { params = JSON.parse(title.getAttribute('data-nlog-params') || '{}'); } catch { /* DOM fallback */ }
      const adLabel = card.querySelector('[class*="adProduct_ad"], [class*="product_ad__"], [class*="ad_label"], [aria-label="광고"]');
      return [{ ...context, rank: index + 1,
        productId: title.getAttribute('data-shp-contents-id') || (productUrl ? new URL(productUrl).searchParams.get('nvMid') : '') || '',
        productName, productUrl,
        imageUrl: absolute(image?.getAttribute('data-src') || image?.currentSrc || image?.getAttribute('src') || '', base),
        sellerName: clean(seller?.textContent || seller?.querySelector('img')?.getAttribute('alt')),
        sellerUrl: seller?.getAttribute('href') && seller.getAttribute('href') !== '#' ? absolute(seller.getAttribute('href'), base) : '',
        price: money(text(card, '[class*="price_num__"]') || text(card, '[class*="price_num_"]') || text(card, '[class*="basicList_price__"]')),
        couponPrice: money(text(card, '[class*="price_discount_price__"]') || text(card, '[class*="coupon_price"]')),
        originalPrice: money(text(card, '[class*="price_org_price__"]') || text(card, 'del')),
        shipping: text(card, '[class*="price_delivery_fee__"], [class*="basicList_delivery__"]'),
        isAd: params.is_ad === true || Boolean(adLabel) || /adProduct_item__/.test(card.className),
        productType: sellers.length ? 'catalog' : 'single', sellers, collectedAt: new Date().toISOString()
      }];
    });
  }
  function pageIssue(doc) {
    const body = clean(doc.body?.innerText || doc.body?.textContent);
    if (doc.querySelector('iframe[src*="captcha"], input[name*="captcha"], #captcha, .captcha') || /보안\s*확인|자동입력\s*방지|비정상적인\s*접근|접근이\s*제한|서비스 접속이 불가|로봇이 아닙/.test(body)) return '접근 제한 또는 보안 확인 화면입니다. 검색 탭을 직접 확인한 뒤 재개하세요.';
    return '';
  }
  root.NSCExtractor = { extractProducts, pageIssue, titleSelector };
  if (typeof module !== 'undefined') module.exports = root.NSCExtractor;
})(globalThis);
