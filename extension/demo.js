const byId = id => document.getElementById(id);
const frame = byId('panel');
let model = NSCDemo.createDemo(), index = 0, playing = false, ready = false, status = 'running', elapsed = 0, lastTick = performance.now();
function duration() { return model.steps[index].waitSeconds ? model.steps[index].waitSeconds * 1000 / Number(byId('speed').value) : 1800; }
function state() {
  const step = model.steps[index];
  const remaining = step.waitSeconds ? Math.max(0, Math.ceil(step.waitSeconds * (1 - elapsed / duration()))) : 0;
  return NSCDemo.stateAt(model, index, status, remaining);
}
function publish() { if (ready) frame.contentWindow.postMessage({ type: 'NSC_DEMO_STATE', state: state() }, location.origin); }
function drawProducts() {
  const step = model.steps[index];
  const products = model.products.filter(v => v.keyword === model.keywords[step.keywordIndex] && v.page === step.page);
  byId('mock-products').replaceChildren(...products.map(item => {
    const card = document.createElement('article'); card.className = 'mock-card'; card.id = `mock-product-${item.rank}`;
    if (step.highlight?.includes(item.rank)) card.classList.add('highlight');
    const image = document.createElement('img'); image.src = item.imageUrl; image.alt = '예시 상품';
    const copy = document.createElement('div'); copy.className = 'copy';
    const title = document.createElement('h2'); title.textContent = item.productName;
    const price = document.createElement('strong'); price.textContent = `${item.price.toLocaleString('ko-KR')}원`;
    const details = document.createElement('p'); details.textContent = '예시 상품 정보 · 배송비 별도\n상품명 / 이미지 / 업체명 / 가격을 확인합니다.';
    copy.append(title, price, details);
    const seller = document.createElement('div'); seller.className = 'seller'; seller.textContent = item.sellerName;
    card.append(image, copy, seller); return card;
  }));
  const target = step.scrolls ? byId('mock-product-4') : byId('mock-products');
  byId('mock-viewport').scrollTo({ top: step.scrolls ? target.offsetTop - byId('mock-products').offsetTop : 0, behavior: 'smooth' });
}
function render(changeStep = false) {
  const step = model.steps[index], current = state();
  byId('play').textContent = playing ? '데모 일시정지' : index === model.steps.length - 1 || status === 'stopped' ? '다시 재생' : '데모 재생';
  byId('play').disabled = byId('next').disabled = byId('reset').disabled = !ready;
  byId('next').disabled = !ready || index === model.steps.length - 1 || status === 'stopped';
  byId('step-count').textContent = `${index + 1} / ${model.steps.length} 단계`;
  byId('address').textContent = NSC.searchUrl(model.keywords[step.keywordIndex], step.page);
  byId('mock-query').textContent = model.keywords[step.keywordIndex]; byId('mock-page').textContent = `${step.page}페이지`;
  byId('stage').textContent = step.phase === 'done' ? step.stage : status === 'paused' ? `${step.stage} · 일시정지` : status === 'stopped' ? '데모 종료' : step.stage;
  byId('stage-description').textContent = current.job?.message || step.message;
  byId('demo-wait').textContent = current.demoRemainingSeconds ? `예시 ${current.demoRemainingSeconds}초` : '';
  if (changeStep) {
    byId('mock-pagination').replaceChildren(...Array.from({ length: model.settings.maxPages }, (_, i) => {
      const page = document.createElement('span'); page.textContent = String(i + 1); page.classList.toggle('selected', step.page === i + 1); return page;
    }));
    drawProducts();
    byId('timeline').replaceChildren(...['검색 페이지 열기', '상품 정보 확인', '스크롤 전 무작위 대기', '스크롤 · 지연 로딩 확인', '다음 페이지로 이동', '다음 검색어 대기', '탐색 완료'].map(stage => {
      const button = document.createElement('button'); button.textContent = stage; button.classList.toggle('active', stage === step.stage);
      button.disabled = model.steps.findIndex(v => v.stage === stage) < 0;
      button.addEventListener('click', () => {
        const nextIndex = model.steps.findIndex(v => v.stage === stage); if (nextIndex >= 0) { index = nextIndex; elapsed = 0; playing = false; status = 'paused'; render(true); }
      }); return button;
    }));
  }
  publish();
}
function next() {
  if (index < model.steps.length - 1) { index++; elapsed = 0; }
  if (index === model.steps.length - 1) playing = false;
  render(true);
}
function play() {
  if (index === model.steps.length - 1 || status === 'stopped') { index = 0; elapsed = 0; }
  playing = !playing; status = playing ? 'running' : 'paused'; lastTick = performance.now();
  if (playing && index === 0) next(); else render(true);
}
function reset() { playing = false; status = 'running'; index = 0; elapsed = 0; render(true); }
byId('play').addEventListener('click', play);
byId('next').addEventListener('click', () => { playing = false; status = 'paused'; next(); });
byId('reset').addEventListener('click', reset);
byId('speed').addEventListener('change', () => { elapsed = 0; render(); });
window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  if (event.data?.type === 'NSC_DEMO_READY') { ready = true; render(true); return; }
  if (event.data?.type !== 'NSC_DEMO_ACTION') return;
  switch (event.data.action) {
    case 'CONFIG': model = NSCDemo.createDemo(NSC.parseKeywords(event.data.keywords), event.data.settings); reset(); break;
    case 'START': model = NSCDemo.createDemo(NSC.parseKeywords(event.data.keywords), event.data.settings); reset(); play(); break;
    case 'PAUSE': playing = false; status = 'paused'; render(); break;
    case 'RESUME': playing = true; status = 'running'; lastTick = performance.now(); render(); break;
    case 'STOP': playing = false; status = 'stopped'; render(); break;
    case 'CLEAR': reset(); break;
  }
});
setInterval(() => {
  const now = performance.now(), delta = now - lastTick; lastTick = now;
  if (!playing) return;
  elapsed += delta;
  if (elapsed >= duration()) next(); else render();
}, 250);
render(true);
