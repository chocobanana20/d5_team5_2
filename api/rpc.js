import { timingSafeEqual } from 'node:crypto';

const ACTIONS = new Set(['getDashboard','recordWarning','saveTask','updateTask']);
function equal(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow','POST');
    return res.status(405).json({ok:false,error:'POST 요청만 가능합니다.'});
  }
  const {APPS_SCRIPT_URL, APPS_SCRIPT_SECRET, APP_PASSWORD} = process.env;
  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_SECRET || !APP_PASSWORD)
    return res.status(503).json({ok:false,error:'Vercel 환경변수 세 개를 설정하고 재배포해주세요.'});
  const password = req.headers['x-team-password'];
  if (typeof password !== 'string' || !equal(password, APP_PASSWORD))
    return res.status(401).json({ok:false,error:'팀 앱 비밀번호가 다릅니다. 새로고침을 눌러 다시 입력하세요.'});
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || !ACTIONS.has(body.action) || !Array.isArray(body.args) || body.args.length > 1)
      return res.status(400).json({ok:false,error:'요청 기능 또는 형식이 올바르지 않습니다.'});
    if (JSON.stringify(body).length > 50000)
      return res.status(413).json({ok:false,error:'입력 내용이 너무 깁니다.'});
    const url = new URL(APPS_SCRIPT_URL);
    if (url.origin !== 'https://script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname))
      return res.status(503).json({ok:false,error:'APPS_SCRIPT_URL에 /exec로 끝나는 웹앱 배포 주소를 설정하세요.'});
    const upstream = await fetch(url, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:body.action,args:body.args,secret:APPS_SCRIPT_SECRET}),
      redirect:'follow', signal:AbortSignal.timeout(45000)
    });
    const raw = await upstream.text();
    let result;
    try { result = JSON.parse(raw); }
    catch (_) { return res.status(502).json({ok:false,error:'Apps Script가 JSON 대신 로그인/오류 화면을 반환했습니다. 배포 접근 권한과 /exec 주소를 확인하세요.'}); }
    if (!upstream.ok || !result.ok)
      return res.status(502).json({ok:false,error:result.error || 'Apps Script 요청 실패'});
    return res.status(200).json(result);
  } catch (error) {
    return res.status(502).json({ok:false,error:error.name === 'TimeoutError'
      ? 'Apps Script 응답 시간 초과. 저장 요청이었다면 과제 현황을 먼저 확인하세요.'
      : '연결 오류: ' + error.message});
  }
}
