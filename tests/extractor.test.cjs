const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parseHTML}=require('linkedom');
const {extractProducts,pageIssue}=require('../extension/extractor');
const context={keyword:'플래티넘 사료',page:1,sourceUrl:'https://search.shopping.naver.com/search/all?query=test'};
const doc=html=>parseHTML(`<html><body>${html}</body></html>`).document;
test('current product DOM separates original, sale and coupon prices and seller name',()=>{
  const document=doc(`<div class="product_item__KQayS"><div class="product_inner__O9F_g">
    <div class="product_img_area__ziVZA"><img src="https://shopping-phinf.pstatic.net/example.jpg"></div>
    <div class="product_title__ljFM_"><a data-shp-area-id="title" data-shp-contents-id="90387246310" data-nlog-params='{"is_ad":false}' href="https://cr.shopping.naver.com/adcr?nvMid=90387246310" title="플래티넘 습식사료">플래티넘 <b>습식</b>사료</a></div>
    <del class="price_org_price__2W2CX">정상가117,600원</del><span class="price_rate__8puN8">32%</span>
    <span class="price_num__Y66T7"><em>79,600</em>원</span><div class="price_unit_price__A1y0Y">100g당3,685원</div>
    <span class="price_discount_price__v3ETJ"><strong>79,400</strong>원</span>
    <div class="price_delivery_fee__8n1e5">배송비무료</div><a class="product_mall__0cRyd" href="https://smartstore.naver.com/mall">몬트라움</a>
  </div></div>`);
  const [item]=extractProducts(document,context);
  assert.equal(item.productName,'플래티넘 습식사료');assert.equal(item.price,79600);assert.equal(item.couponPrice,79400);assert.equal(item.originalPrice,117600);assert.equal(item.sellerName,'몬트라움');assert.equal(item.productId,'90387246310');assert.equal(item.isAd,false);assert.equal(item.imageUrl,'https://shopping-phinf.pstatic.net/example.jpg');
});
test('catalog seller list is retained without assigning a false single seller',()=>{
  const [item]=extractProducts(doc(`<div class="product_item__x"><div class="product_title__x"><a href="https://cr.shopping.naver.com/adcr?nvMid=1">비교 상품</a></div><span class="price_num__x">4,900원</span><div class="product_mall_list__x"><a class="product_mall_item__x" href="#" title="판매처 A"><span class="product_mall_name__x">판매처 A</span>4,900</a><a class="product_mall_item__x" href="#" title="판매처 B"><span class="product_mall_name__x">판매처 B</span>5,000</a></div></div>`),context);
  assert.equal(item.productType,'catalog');assert.equal(item.sellerName,'');assert.equal(item.sellers.length,2);assert.deepEqual(item.sellers[0],{name:'판매처 A',price:4900,url:''});assert.equal(item.imageUrl,'');
});
test('adcr redirect alone does not mean an advertisement; explicit metadata does',()=>{
  const make=ad=>doc(`<div class="product_item__x"><a data-shp-area-id="title" data-nlog-params='{"is_ad":${ad}}' href="https://cr.shopping.naver.com/adcr?nvMid=1">상품</a></div>`);
  assert.equal(extractProducts(make(false),context)[0].isAd,false);assert.equal(extractProducts(make(true),context)[0].isAd,true);
});
test('legacy card, lazy image, missing values and unsafe URLs',()=>{
  const [item]=extractProducts(doc(`<li class="basicList_item__x"><a class="basicList_link__x" href="javascript:alert(1)">기존 상품</a><img data-src="https://example.com/lazy.jpg"><span class="basicList_price__x">119,200원</span><a class="basicList_mall__x"><img alt="업체 로고"></a></li>`),context);
  assert.equal(item.price,119200);assert.equal(item.couponPrice,null);assert.equal(item.imageUrl,'https://example.com/lazy.jpg');assert.equal(item.productUrl,'');assert.equal(item.sellerName,'업체 로고');
});
test('unrelated recommendations are excluded and challenge screens are detected',()=>{
  assert.equal(extractProducts(doc('<a href="/item" title="상품">추천상품</a>'),context).length,0);
  assert.match(pageIssue(doc('<h1>비정상적인 접근</h1>')),/접근 제한/);assert.match(pageIssue(doc('<iframe src="https://example.com/captcha"></iframe>')),/접근 제한/);assert.equal(pageIssue(doc('<p>정상 상품 목록</p>')),'');
});
