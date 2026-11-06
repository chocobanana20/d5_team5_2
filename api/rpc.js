const ALLOWED_ACTIONS = new Set([
  'getDashboard',
  'recordWarning',
  'saveTask',
  'updateTask'
]);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      ok: false,
      error: 'POST 요청만 가능합니다.'
    });
  }

  const {
    APPS_SCRIPT_URL,
    APPS_SCRIPT_SECRET
  } = process.env;

  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_SECRET) {
    return res.status(503).json({
      ok: false,
      error:
        'Vercel 환경변수 APPS_SCRIPT_URL과 ' +
        'APPS_SCRIPT_SECRET을 설정한 뒤 재배포해주세요.'
    });
  }

  let body;

  try {
    body = typeof req.body === 'string'
      ? JSON.parse(req.body)
      : req.body;
  } catch (_) {
    return res.status(400).json({
      ok: false,
      error: '요청 데이터가 올바른 JSON 형식이 아닙니다.'
    });
  }

  if (
    !body ||
    !ALLOWED_ACTIONS.has(body.action) ||
    !Array.isArray(body.args) ||
    body.args.length > 1
  ) {
    return res.status(400).json({
      ok: false,
      error: '요청 기능 또는 형식이 올바르지 않습니다.'
    });
  }

  if (JSON.stringify(body).length > 50000) {
    return res.status(413).json({
      ok: false,
      error: '입력 내용이 너무 깁니다.'
    });
  }

  let url;

  try {
    url = new URL(APPS_SCRIPT_URL);
  } catch (_) {
    return res.status(503).json({
      ok: false,
      error: 'APPS_SCRIPT_URL이 올바른 주소가 아닙니다.'
    });
  }

  if (
    url.origin !== 'https://script.google.com' ||
    !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)
  ) {
    return res.status(503).json({
      ok: false,
      error:
        'APPS_SCRIPT_URL에 /exec로 끝나는 ' +
        'Apps Script 웹앱 배포 주소를 넣어주세요.'
    });
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: body.action,
        args: body.args,
        secret: APPS_SCRIPT_SECRET
      }),
      redirect: 'follow',
      signal: AbortSignal.timeout(45000)
    });

    const text = await response.text();
    let result;

    try {
      result = JSON.parse(text);
    } catch (_) {
      return res.status(502).json({
        ok: false,
        error:
          'Apps Script가 데이터 대신 로그인 또는 오류 화면을 ' +
          '반환했습니다. 웹앱 배포 접근 권한과 /exec 주소를 확인해주세요.'
      });
    }

    if (!result || typeof result !== 'object') {
      return res.status(502).json({
        ok: false,
        error: 'Apps Script 응답 형식이 올바르지 않습니다.'
      });
    }

    if (!response.ok || !result.ok) {
      return res.status(502).json({
        ok: false,
        error: result.error || 'Apps Script 요청에 실패했습니다.'
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error:
        error.name === 'TimeoutError' ||
        error.name === 'AbortError'
          ? 'Apps Script 응답 시간이 초과됐습니다. ' +
            '저장 요청이었다면 과제 현황을 먼저 확인해주세요.'
          : '연결 오류: ' + error.message
    });
  }
}
