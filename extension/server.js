/* Server settings shared by the dashboard, service worker and offline tests. */
(function (root) {
  const apiPath = '/api/naver-collector/v1';
  // apps/admin-api/conf/local.yaml uses server.port 8080 unless PORT overrides it.
  const defaultServerUrl = 'http://localhost:8080';
  class ConnectionError extends Error {}
  function normalizeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('서버 주소를 입력하세요.');
    let url;
    try { url = new URL(value.trim()); } catch { throw new Error('https://로 시작하는 서버 주소를 입력하세요.'); }
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('HTTPS 주소를 사용하세요. 로컬 테스트는 http://localhost 또는 http://127.0.0.1을 사용할 수 있습니다.');
    if (url.username || url.password || url.search || url.hash || !['/', '', apiPath, apiPath + '/'].includes(url.pathname)) throw new Error('계정 정보·쿼리 없이 서버의 기본 주소를 입력하세요.');
    return url.origin;
  }
  function connection(input, previous = {}) {
    const serverUrl = normalizeUrl(input.serverUrl);
    if (input.token !== undefined && typeof input.token !== 'string') throw new Error('접속 토큰을 확인하세요.');
    const token = (input.token || '').trim() || (previous.serverUrl === serverUrl ? previous.token : '');
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('서버에 등록된 32~256자 토큰을 입력하세요. 주소를 변경할 때는 토큰을 다시 입력해야 합니다.');
    return { serverUrl, token };
  }
  function publicConfig(config) {
    return { serverUrl: config?.serverUrl || defaultServerUrl, hasToken: Boolean(config?.token) };
  }
  async function check(config, fetcher = root.fetch, timeoutMs = 10000) {
    const { serverUrl, token } = connection(config);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(serverUrl + apiPath + '/tasks?limit=1', {
        method: 'GET', headers: { Authorization: 'Bearer ' + token },
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal
      });
      const messages = {
        401: '인증 실패 · 서버에 등록된 토큰인지 확인하세요.',
        403: '접근 거절 · 서버의 허용 확장 ID 설정을 확인하세요.',
        404: '수집 API를 찾지 못했습니다. 서버 주소를 확인하세요.',
        426: '서버의 HTTPS·프록시 설정을 확인하세요.',
        429: '요청이 많습니다. 잠시 후 다시 확인하세요.',
        503: '서버가 요청을 처리하지 못했습니다. 서버의 DB 연결을 확인하세요.'
      };
      if (!response.ok) throw new ConnectionError(messages[response.status] || '서버 연결에 실패했습니다. 서버 상태를 확인하세요.');
      let body;
      try { body = await response.json(); } catch { throw new ConnectionError('수집 서버의 JSON 응답을 확인하세요.'); }
      if (body?.ok !== true || !Array.isArray(body.data?.tasks)) throw new ConnectionError('수집 서버의 API 응답 형식이 올바르지 않습니다.');
      return { connected: true };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('서버 응답 시간이 초과되었습니다. 서버 실행 상태를 확인하세요.');
      if (error instanceof TypeError) throw new Error('서버에 연결하지 못했습니다. 주소·네트워크·사이트 접근 권한을 확인하세요.');
      // Only our fixed messages leave this module; never echo server bodies or URLs.
      if (error instanceof ConnectionError) throw error;
      throw new Error('서버에 연결하지 못했습니다. 주소·네트워크·사이트 접근 권한을 확인하세요.');
    } finally { clearTimeout(timeout); }
  }
  async function api(config, path, body, fetcher = root.fetch) {
    const { serverUrl, token } = connection(config);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetcher(serverUrl + apiPath + path, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      let value; try { value = await response.json(); } catch (_) { throw new ConnectionError('수집 서버의 JSON 응답을 확인하세요.'); }
      if (!response.ok || value.ok !== true) throw new ConnectionError(response.status === 401 ? '접속 토큰을 확인하세요.' : '결과 전송에 실패했습니다. 서버 연결과 DB를 확인하세요.');
      return value.data;
    } catch (error) {
      if (error instanceof ConnectionError) throw error;
      throw new Error('서버에 연결하지 못했습니다. 저장된 결과로 다시 시도하세요.');
    } finally { clearTimeout(timer); }
  }
  root.NSCServer = { apiPath, defaultServerUrl, normalizeUrl, connection, publicConfig, check, api };
  if (typeof module !== 'undefined') module.exports = root.NSCServer;
})(globalThis);
