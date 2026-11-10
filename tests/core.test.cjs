const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/core');
test('validates string arrays, trims and deduplicates keywords', () => {
  assert.deepEqual(core.parseKeywords('[" 사료 ","간식","사료"]'), ['사료', '간식']);
  for (const value of ['[]', '{}', '[1]', '[""]', '["a",null]', '사료']) assert.throws(() => core.parseKeywords(value));
});
test('uniform integer ranges include both required endpoints', () => {
  for (const [min, max] of [[10,70],[180,600]]) {
    assert.equal(core.randomSeconds(min,max,()=>0), min);
    assert.equal(core.randomSeconds(min,max,()=>0.99999999), max);
    for (let i=0;i<1000;i++) { const n=core.randomSeconds(min,max); assert(n >= min && n <= max && Number.isInteger(n)); }
  }
  assert.deepEqual(core.timing, {actionMin:10,actionMax:70,keywordMin:180,keywordMax:600});
});
test('search query is encoded, page identity is strict and 80 items per page is the default', () => {
  const keyword='플래티넘 사료 & +', url=core.searchUrl(keyword,2);
  const params=new URL(url).searchParams;
  assert.equal(params.get('query'), keyword);
  assert.equal(params.get('pagingIndex'),'2');
  assert.equal(params.get('pagingSize'),'80');
  assert.equal(params.get('catId'),null);
  const catUrl=core.searchUrl(keyword,1,{pagingSize:40,catId:'50000155'});
  assert.equal(new URL(catUrl).searchParams.get('pagingSize'),'40');
  assert.equal(new URL(catUrl).searchParams.get('catId'),'50000155');
  const job={keywords:[keyword],keywordIndex:0,page:2};
  assert(core.matchesPage(url,job)); assert(!core.matchesPage(core.searchUrl(keyword,1),job));
  assert(!core.matchesPage(url.replace('https:','http:'),job));
});
test('merge updates lazy images and preserves rank, keyword/page and ad distinctions', () => {
  const a={keyword:'사료',page:1,rank:1,productId:'1',imageUrl:'',sellerName:'A',sellers:[],isAd:false};
  const result=core.mergeItems([a],[{...a,rank:5,imageUrl:'https://example.com/image.jpg',sellerName:''},{...a,page:2},{...a,keyword:'간식'},{...a,isAd:true}]);
  assert.equal(result.length,4); assert.equal(result[0].rank,1); assert.equal(result[0].sellerName,'A'); assert.equal(result[0].imageUrl,'https://example.com/image.jpg');
});
test('CSV includes BOM, escapes quotes/newlines and neutralizes formula cells', () => {
  const csv=core.toCsv([{keyword:'=HYPERLINK("bad")',productName:'a,"b"\nc',price:119200,sellers:[{name:'판매처'}]}]);
  assert(csv.startsWith('\uFEFF')); assert(csv.includes("\"'=HYPERLINK(\"\"bad\"\")\"")); assert(csv.includes('"a,""b""\nc"')); assert(csv.includes('"119200"'));
});
test('settings validate new limits and keep defaults for old jobs', () => {
  assert.deepEqual(core.normalizeSettings(), core.defaultSettings);
  assert.equal(core.normalizeSettings().pagingSize,80);assert.equal(core.normalizeSettings().maxPages,1);assert.equal(core.normalizeSettings().catId,'');
  assert.deepEqual(core.normalizeSettings({maxPages:10,scrollPercent:50,actionMin:5,actionMax:300,keywordMin:60,keywordMax:1200}),{maxPages:10,pagingSize:80,catId:'',scrollPercent:50,actionMin:5,actionMax:300,keywordMin:60,keywordMax:1200});
  assert.equal(core.normalizeSettings({catId:' 50000155 '}).catId,'50000155');
  for(const settings of [null,[],{maxPages:0},{maxPages:11},{scrollPercent:25},{actionMin:4},{actionMax:301},{keywordMin:59},{keywordMax:1201},{actionMin:70,actionMax:10},{keywordMin:600,keywordMax:60},{maxPages:'3'},{pagingSize:20},{pagingSize:'80'},{catId:'abc'},{catId:'1234567890123'}]) assert.throws(()=>core.normalizeSettings(settings));
});
