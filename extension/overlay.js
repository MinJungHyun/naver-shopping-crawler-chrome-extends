/* Injected on demand: shows the dashboard as a floating layer on top of the page. */
(() => {
  const ID = 'nsc-layer';
  if (document.getElementById(ID)) return;
  // A semantic complementary landmark rather than a generic div.
  const host = document.createElement('aside');
  host.id = ID;
  host.setAttribute('role', 'complementary');
  host.setAttribute('aria-label', '네이버 쇼핑 수집기');
  Object.assign(host.style, {
    position: 'fixed', top: '0', right: '0', height: '100vh', width: 'min(380px, 100vw)',
    zIndex: '2147483646', background: '#fff', borderLeft: '1px solid #dfe7e2',
    boxShadow: '-10px 0 30px rgba(15, 40, 30, .18)', display: 'block', colorScheme: 'light'
  });
  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('dashboard.html?embed=1');
  frame.title = '네이버 쇼핑 수집기';
  frame.setAttribute('allow', 'clipboard-write');
  Object.assign(frame.style, { width: '100%', height: '100%', border: '0', display: 'block', background: '#fff' });
  host.append(frame);
  // Keep the landmark inside the document body when possible.
  (document.body || document.documentElement).append(host);

  let ready = false;
  const cleanup = () => { window.removeEventListener('message', onMessage); host.remove(); };
  function onMessage(event) {
    if (event.source !== frame.contentWindow) return;
    if (event.data?.type === 'NSC_OVERLAY_READY') { ready = true; clearTimeout(timer); }
    if (event.data?.type === 'NSC_OVERLAY_CLOSE') cleanup();
  }
  window.addEventListener('message', onMessage);
  // A strict page CSP can block extension frames; fall back to a popup window.
  const timer = setTimeout(() => {
    if (ready) return;
    cleanup();
    chrome.runtime.sendMessage({ type: 'OVERLAY_FAILED' }).catch(() => {});
  }, 3000);
})();
