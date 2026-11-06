
const TASK_SHEET = '개선과제 목록';
const WARN_SHEET = '누락경고 기록';

const TASK_HEADERS = [
  '과제ID', '대상공정', '문제', '개선내용',
  '담당자', '완료기한', '완료기준', '입력완료여부',
  '대기발생여부', '대기사유', '진행상태', '우선순위',
  '개선전대기건수', '개선후대기건수',
  '측정시작일', '측정종료일', '완료일', '등록일시'
];

const WARN_HEADERS = [
  '경고ID', '과제ID', '누락항목',
  '경고발생일시', '보완후저장완료'
];

const REQUIRED = {
  process: '대상공정',
  problem: '문제',
  improvement: '개선내용',
  manager: '담당자',
  deadline: '완료기한',
  criteria: '완료기준'
};

// 기본 주소 = Team Page
// ?page=app = 공정개선 앱
function doGet() {
  return json_({success: true, service: '공정개선 API'});
}

function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

function getSheet_(name, headers) {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw Error('편집기에서 setup을 먼저 실행하세요.');
  const ss = SpreadsheetApp.openById(id);
  if (!ss) {
    throw Error('구글 시트에 연결된 Apps Script를 사용하세요.');
  }

  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length)
      .setBackground('#16345e')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
  } else {
    const old = sh.getRange(1, 1, 1, headers.length)
      .getDisplayValues()[0];

    headers.forEach((h, i) => {
      if (old[i] && old[i] !== h) {
        throw Error(name + ' 탭 ' + (i + 1) +
          '열의 헤더가 다릅니다: ' + old[i]);
      }
      if (!old[i]) sh.getRange(1, i + 1).setValue(h);
    });
  }

  return sh;
}

function sheets_() {
  return {
    tasks: getSheet_(TASK_SHEET, TASK_HEADERS),
    warnings: getSheet_(WARN_SHEET, WARN_HEADERS)
  };
}

function locked_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function today_() {
  return Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );
}

function validDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCFullYear() === y &&
    x.getUTCMonth() + 1 === m &&
    x.getUTCDate() === d;
}

function safe_(v) {
  const s = String(v ?? '').trim();
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function nextId_(sh, prefix) {
  if (sh.getLastRow() < 2) return prefix + '-001';

  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1)
    .getDisplayValues().flat();

  const max = ids.reduce((n, v) => {
    const m = String(v).match(
      new RegExp('^' + prefix + '-(\\d+)$')
    );
    return m ? Math.max(n, Number(m[1])) : n;
  }, 0);

  return prefix + '-' + String(max + 1).padStart(3, '0');
}

function missing_(d) {
  return Object.keys(REQUIRED)
    .filter(k => !String((d || {})[k] ?? '').trim())
    .map(k => REQUIRED[k]);
}

// 필수 항목 누락 경고 저장
function recordWarning(d) {
  return locked_(() => {
    try {
      const missing = missing_(d);
      if (!missing.length) throw Error('누락 항목이 없습니다.');

      const sh = sheets_().warnings;
      const id = nextId_(sh, 'WARN');

      sh.appendRow([
        id, '', missing.join(', '), new Date(), '아니오'
      ]);

      return { success: true, id, missing };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });
}

// 개선과제 등록
function saveTask(d) {
  return locked_(() => {
    try {
      d = d || {};
      const missing = missing_(d);

      if (missing.length) {
        throw Error('누락 항목: ' + missing.join(', '));
      }
      if (!validDate_(String(d.deadline))) {
        throw Error('완료기한을 확인하세요.');
      }

      const priority = d.priority || '보통';
      if (!['높음', '보통', '낮음'].includes(priority)) {
        throw Error('우선순위 오류');
      }

      const sh = sheets_();
      const id = nextId_(sh.tasks, 'TASK');
      let warningRow = 0;

      if (d.warningId) {
        const ws = sh.warnings;
        if (ws.getLastRow() < 2) {
          throw Error('누락 경고 기록이 없습니다.');
        }

        const rows = ws.getRange(
          2, 1, ws.getLastRow() - 1, 5
        ).getDisplayValues();

        const idx = rows.findIndex(r =>
          r[0] === d.warningId && r[4] === '아니오'
        );

        if (idx < 0) {
          throw Error('유효한 누락 경고를 찾을 수 없습니다.');
        }
        warningRow = idx + 2;
      }

      sh.tasks.appendRow([
        id,
        safe_(d.process),
        safe_(d.problem),
        safe_(d.improvement),
        safe_(d.manager),
        d.deadline,
        safe_(d.criteria),
        '완료',
        '아니오',
        '해당 없음',
        '계획',
        priority,
        '', '', '', '', '',
        new Date()
      ]);

      if (warningRow) {
        sh.warnings.getRange(warningRow, 2).setValue(id);
        sh.warnings.getRange(warningRow, 5).setValue('예');
      }

      return {
        success: true,
        id,
        message: '개선과제 등록 완료'
      };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });
}

// 과제 목록 조회
function readTasks_() {
  const sh = sheets_().tasks;
  if (sh.getLastRow() < 2) return [];

  const now = today_();

  return sh.getRange(2, 1, sh.getLastRow() - 1, 18)
    .getDisplayValues()
    .filter(r => r[0])
    .map(r => {
      const status = r[10] || '계획';
      const overdue = status !== '완료' &&
        !!r[5] && r[5] < now;

      return {
        id: r[0],
        process: r[1],
        problem: r[2],
        improvement: r[3],
        manager: r[4],
        deadline: r[5],
        criteria: r[6],
        status,
        displayStatus: overdue ? '지연' : status,
        priority: r[11] || '보통',
        before: r[12],
        after: r[13],
        start: r[14],
        end: r[15],
        completedAt: r[16],
        createdAt: r[17],
        overdue,
        hasMeasurement: r[12] !== '' &&
          r[13] !== '' && !!r[14] && !!r[15]
      };
    });
}

// 대시보드 통계 및 그래프 데이터
function getDashboard() {
  const sh = sheets_();
  const tasks = readTasks_();

  const warnings = sh.warnings.getLastRow() > 1
    ? sh.warnings.getRange(
        2, 1, sh.warnings.getLastRow() - 1, 5
      ).getDisplayValues().filter(r => r[0])
    : [];

  const measured = tasks.filter(t => t.hasMeasurement);

  const before = measured.reduce(
    (s, t) => s + Number(t.before), 0
  );
  const after = measured.reduce(
    (s, t) => s + Number(t.after), 0
  );

  const corrected = warnings.filter(
    r => r[4] === '예'
  ).length;

  const missing = {};
  warnings.forEach(r => {
    String(r[2]).split(',').forEach(x => {
      const name = x.trim();
      if (name) missing[name] = (missing[name] || 0) + 1;
    });
  });

  const monthly = {};
  const managers = {};

  tasks.forEach(t => {
    const month = String(t.createdAt).slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) {
      monthly[month] = (monthly[month] || 0) + 1;
    }

    const name = t.manager || '미지정';
    if (!managers[name]) {
      managers[name] = {
        name, total: 0, completed: 0, overdue: 0
      };
    }
    managers[name].total++;
    if (t.status === '완료') managers[name].completed++;
    if (t.overdue) managers[name].overdue++;
  });

  return {
    tasks: tasks.reverse(),
    summary: {
      total: tasks.length,
      planned: tasks.filter(t => t.status === '계획').length,
      active: tasks.filter(t => t.status === '진행 중').length,
      completed: tasks.filter(t => t.status === '완료').length,
      overdue: tasks.filter(t => t.overdue).length
    },
    kpi: {
      result: {
        measured: measured.length,
        before,
        after,
        reduction: before > 0
          ? (before - after) / before * 100
          : null
      },
      process: {
        total: warnings.length,
        corrected,
        rate: warnings.length
          ? corrected / warnings.length * 100
          : null
      }
    },
    charts: {
      monthly: Object.keys(monthly).sort()
        .map(name => ({ name, value: monthly[name] })),
      missing: Object.keys(missing)
        .map(name => ({ name, value: missing[name] }))
        .sort((a, b) => b.value - a.value),
      managers: Object.values(managers)
        .sort((a, b) => b.total - a.total)
    },
    generatedAt: Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    )
  };
}

// 진행 상태 및 개선 전후 성과 저장
function updateTask(d) {
  return locked_(() => {
    try {
      d = d || {};
      const sh = sheets_().tasks;

      if (sh.getLastRow() < 2) {
        throw Error('등록된 과제가 없습니다.');
      }

      const ids = sh.getRange(
        2, 1, sh.getLastRow() - 1, 1
      ).getDisplayValues().flat();

      const idx = ids.indexOf(String(d.id));
      if (idx < 0) throw Error('과제를 찾을 수 없습니다.');

      if (!['계획', '진행 중', '완료'].includes(d.status)) {
        throw Error('진행 상태 오류');
      }
      if (!['높음', '보통', '낮음'].includes(d.priority)) {
        throw Error('우선순위 오류');
      }

      const before = String(d.before ?? '').trim();
      const after = String(d.after ?? '').trim();
      const start = String(d.start || '');
      const end = String(d.end || '');

      const values = [before, after, start, end];
      const any = values.some(Boolean);
      const all = values.every(Boolean);

      if (any && !all) {
        throw Error('전후 건수와 측정 기간을 모두 입력하세요.');
      }

      if (all) {
        if (!/^\d+$/.test(before) ||
            !/^\d+$/.test(after)) {
          throw Error('대기 건수는 0 이상의 정수여야 합니다.');
        }
        if (!validDate_(start) ||
            !validDate_(end) || start > end) {
          throw Error('측정 기간을 확인하세요.');
        }
      }

      const row = idx + 2;
      const completed = sh.getRange(row, 17)
        .getDisplayValue();

      const waiting = all && Number(after) > 0
        ? '예' : '아니오';

      sh.getRange(row, 9, 1, 9).setValues([[
        waiting,
        waiting === '예' ? '정보 누락' : '해당 없음',
        d.status,
        d.priority,
        all ? Number(before) : '',
        all ? Number(after) : '',
        all ? start : '',
        all ? end : '',
        d.status === '완료'
          ? (completed || today_())
          : ''
      ]]);

      return {
        success: true,
        message: '변경사항이 저장되었습니다.'
      };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });
}


// 최초 한 번: 연결할 시트의 Apps Script 편집기에서 실행합니다.
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw Error('구글 시트에서 Apps Script를 열어 실행하세요.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  sheets_();
}
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty('API_SECRET');
    if (!secret || typeof request.secret !== 'string' || request.secret !== secret)
      return json_({ok:false,error:'API 인증 실패'});
    const handlers = {getDashboard,recordWarning,saveTask,updateTask};
    if (!Object.prototype.hasOwnProperty.call(handlers,request.action))
      return json_({ok:false,error:'허용되지 않은 기능'});
    const args = Array.isArray(request.args) ? request.args : [];
    if (args.length > 1) return json_({ok:false,error:'요청 형식 오류'});
    return json_({ok:true,data:handlers[request.action].apply(null,args)});
  } catch (error) {
    return json_({ok:false,error:error.message || String(error)});
  }
}
