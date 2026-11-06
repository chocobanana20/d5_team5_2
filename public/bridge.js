// 기존 화면의 google.script.run 호출을 동일 출처의 Vercel API로 연결합니다.
(function () {
  let credential = sessionStorage.getItem('team-password') || '';
  function runner(success, failure) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === 'withSuccessHandler') return fn => runner(fn, failure);
        if (name === 'withFailureHandler') return fn => runner(success, fn);
        return function (...args) {
          (async function () {
            try {
              if (name === 'getWebAppUrl') {
                // 팀 페이지의 기존 ?page=app 링크를 로컬 앱 주소로 연결합니다.
                if (success) success(location.origin + '/app.html');
                return;
              }
              if (!credential) {
                credential = prompt('팀 앱 비밀번호를 입력해주세요.') || '';
                if (!credential) throw new Error('팀 앱 비밀번호가 필요합니다. 새로고침을 눌러 다시 입력하세요.');
              }
              const response = await fetch('/api/rpc', {
                method: 'POST',
                headers: {'Content-Type':'application/json','X-Team-Password':credential},
                body: JSON.stringify({action:name,args}),
                signal: AbortSignal.timeout(55000)
              });
              let result;
              try { result = await response.json(); }
              catch (_) { throw new Error('서버 응답을 읽지 못했습니다. Vercel 배포 상태를 확인하세요.'); }
              if (response.status === 401) {
                credential = '';
                sessionStorage.removeItem('team-password');
              }
              if (!response.ok || !result.ok) throw new Error(result.error || '서버 요청 실패');
              sessionStorage.setItem('team-password',credential);
              if (success) success(result.data);
            } catch (error) {
              if (error.name === 'TimeoutError') error = new Error('응답 시간이 초과됐습니다. 저장 요청이었다면 과제 목록을 먼저 확인하세요.');
              if (failure) failure(error); else console.error(error);
            }
          })();
        };
      }
    });
  }
  window.google = window.google || {};
  window.google.script = {run:runner()};
})();
