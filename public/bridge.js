// 기존 화면을 Vercel API와 연결합니다.
(function () {
  function createRunner(successHandler, failureHandler) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === 'withSuccessHandler') {
          return function (handler) {
            return createRunner(handler, failureHandler);
          };
        }

        if (name === 'withFailureHandler') {
          return function (handler) {
            return createRunner(successHandler, handler);
          };
        }

        return function (...args) {
          (async function () {
            try {
              // 팀 소개 화면의 앱 실행 버튼 연결
              if (name === 'getWebAppUrl') {
                if (successHandler) {
                  successHandler(
                    window.location.origin + '/app.html'
                  );
                }
                return;
              }

              const response = await fetch('/api/rpc', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  action: name,
                  args: args
                }),
                signal: AbortSignal.timeout(55000)
              });

              let result;

              try {
                result = await response.json();
              } catch (_) {
                throw new Error(
                  '서버 응답을 읽지 못했습니다. ' +
                  'Vercel 배포 상태를 확인해주세요.'
                );
              }

              if (!response.ok || !result.ok) {
                throw new Error(
                  result.error || '서버 요청에 실패했습니다.'
                );
              }

              if (successHandler) {
                successHandler(result.data);
              }
            } catch (error) {
              if (
                error.name === 'TimeoutError' ||
                error.name === 'AbortError'
              ) {
                error = new Error(
                  '응답 시간이 초과됐습니다. ' +
                  '저장 요청이었다면 과제 목록을 먼저 확인해주세요.'
                );
              }

              if (failureHandler) {
                failureHandler(error);
              } else {
                console.error(error);
              }
            }
          })();
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = {
    run: createRunner()
  };
})();
