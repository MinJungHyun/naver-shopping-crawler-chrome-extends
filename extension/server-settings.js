/* This form runs only in the trusted dashboard; preview never saves credentials. */
(function () {
  const form = document.getElementById('server-form');
  const url = document.getElementById('server-url'), token = document.getElementById('server-token');
  const connect = document.getElementById('server-connect'), clear = document.getElementById('server-clear');
  const toggle = document.getElementById('server-token-toggle'), badge = document.getElementById('server-badge');
  const status = document.getElementById('server-status');
  const start = document.getElementById('server-start'), retry = document.getElementById('server-upload');
  let saving = false;
  let savedServer = { serverUrl: '', hasToken: false };
  function message(value, error = false) { status.textContent = value; status.dataset.error = String(error); }
  function publicSettings(server) {
    savedServer = server;
    url.value = server.serverUrl;
    token.value = ''; token.type = 'password';
    toggle.textContent = '표시'; toggle.setAttribute('aria-pressed', 'false'); toggle.setAttribute('aria-label', '접속 토큰 표시');
    token.placeholder = server.hasToken ? '저장된 토큰 사용 · 변경할 때 입력' : '서버에 등록된 토큰 입력';
    badge.textContent = server.hasToken ? '저장됨' : '미설정';
  }
  function lock(value) {
    saving = value;
    for (const element of [url, token, toggle, connect, clear, start, retry]) element.disabled = value;
    connect.textContent = value ? '연결 확인 중…' : '토큰 로그인';
  }
  toggle.addEventListener('click', () => {
    const visible = token.type === 'password'; token.type = visible ? 'text' : 'password';
    toggle.textContent = visible ? '숨김' : '표시'; toggle.setAttribute('aria-pressed', String(visible));
    toggle.setAttribute('aria-label', visible ? '접속 토큰 숨김' : '접속 토큰 표시');
  });
  for (const element of [url, token]) element.addEventListener('input', () => {
    if (!extensionMode) return;
    badge.textContent = '입력 중'; message('저장 후 연결 확인을 눌러 적용하세요.');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || !extensionMode) return;
    try {
      const serverUrl = NSCServer.normalizeUrl(url.value);
      if (token.value.trim()) NSCServer.connection({ serverUrl, token: token.value });
      else if (!savedServer.hasToken || savedServer.serverUrl !== serverUrl) throw new Error('서버에 등록된 토큰을 입력하세요. 주소를 변경할 때는 토큰을 다시 입력해야 합니다.');
      // Must be called directly in this click/submit gesture, before messaging.
      const permission = chrome.permissions.request({ origins: [serverUrl + '/*'] });
      lock(true); message('서버 접근 권한을 확인하고 있습니다.');
      if (!await permission) throw new Error('사이트 접근을 허용해야 서버에 연결할 수 있습니다.');
      const saved = await request('SAVE_SERVER_CONFIG', { serverUrl, token: token.value });
      publicSettings(saved.server);
      message('설정을 저장했습니다. 서버 인증을 확인하고 있습니다.');
      await request('TEST_SERVER_CONNECTION');
      badge.textContent = '연결됨'; message('연결 확인 완료 · 인증과 검색어 조회 API가 정상입니다.');
    } catch (error) { message(error?.message || '연결 설정을 확인하세요.', true); }
    finally { lock(false); }
  });
  clear.addEventListener('click', async () => {
    if (saving || !extensionMode) return;
    lock(true);
    try {
      const result = await request('CLEAR_SERVER_CONFIG'); publicSettings(result.server);
      message('저장한 서버 주소와 토큰을 삭제했습니다.');
    } catch (error) { message(error?.message || '설정을 삭제하지 못했습니다.', true); }
    finally { lock(false); }
  });
  for (const [button, type] of [[start, 'SERVER_START'], [retry, 'RETRY_SERVER_UPLOAD']]) button.addEventListener('click', async () => {
    if (saving || !extensionMode) return;
    lock(true);
    try {
      const result = await request(type, { settings: readSettings(), windowId: (await chrome.windows.getCurrent()).id });
      if (type === 'SERVER_START') message('서버 키워드 수집을 시작했습니다.');
      else if (result?.uploaded === false) message(result.message || '전송하지 못했습니다. 서버 연결을 확인한 뒤 다시 시도하세요.', true);
      else message(result?.message || '전송을 재시도했습니다. 수집 상태를 확인하세요.');
    } catch (error) { message(error.message, true); } finally { lock(false); }
  });
  if (demoMode) { document.getElementById('server-panel').hidden = true; return; }
  if (!extensionMode) {
    connect.disabled = clear.disabled = start.disabled = retry.disabled = true;
    message('화면 미리보기입니다. 저장·연결 확인은 Chrome 확장에서 사용할 수 있습니다.');
    return;
  }
  const extensionId = document.getElementById('server-extension-id');
  extensionId.hidden = false; extensionId.textContent = '서버에 허용할 확장 ID: ' + chrome.runtime.id;
  lock(true);
  request('GET_SERVER_CONFIG').then(result => {
    publicSettings(result.server);
    if (result.server.hasToken) message('설정이 저장되어 있습니다. 연결 확인을 눌러 서버 상태를 확인하세요.');
  }).catch(error => message(error?.message || '저장된 설정을 읽지 못했습니다.', true)).finally(() => lock(false));
})();
