// 구글 시트 확장 프로그램 > Apps Script에 logic.cjs 내용과 함께 붙여넣는 파일.
// 배포: 웹 앱, 실행 계정 = 나, 액세스 = 모든 사용자.
// 스크립트 속성에 TOKEN 키로 비밀 토큰을 저장해야 동작한다.

var SHEET_NAME = '기록';
var HEADER = ['날짜', '종목', '무게(kg)', '횟수', '세트번호', '기록ID'];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER);
    sheet.getRange('A:A').setNumberFormat('@'); // 날짜 자동 변환 방지
  }
  return sheet;
}

function readRecords_() {
  var sheet = getSheet_();
  if (sheet.getLastRow() < 2) return [];
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  var normalized = rows.map(function (r) {
    var d = r[0];
    if (Object.prototype.toString.call(d) === '[object Date]') {
      d = Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
    }
    return [d, r[1], r[2], r[3], r[4], r[5]];
  });
  return rowsToRecords(normalized);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  return Boolean(expected) && token === expected;
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!checkToken_(p.token)) return json_({ ok: false, error: 'bad token' });
  var records = readRecords_();
  if (p.action === 'today') {
    return json_({ ok: true, records: recordsOnDate(records, p.date) });
  }
  if (p.action === 'history') {
    var days = Number(p.days || 90);
    var cutoff = Utilities.formatDate(
      new Date(Date.now() - days * 86400000), 'Asia/Seoul', 'yyyy-MM-dd');
    return json_({
      ok: true,
      records: records.filter(function (r) { return r.date >= cutoff; }),
    });
  }
  if (p.action === 'last') {
    return json_({ ok: true, records: lastSession(records, p.exercise, p.before) });
  }
  if (p.action === 'exercises') {
    return json_({ ok: true, exercises: recentExercises(records) });
  }
  if (p.action === 'chart') {
    return json_({ ok: true, series: chartSeries(records, p.exercise) });
  }
  return json_({ ok: false, error: 'unknown action' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad json' });
  }
  if (!checkToken_(body.token)) return json_({ ok: false, error: 'bad token' });

  if (body.action === 'add') {
    var r = body.record;
    if (!r || !r.id || !r.date || !r.exercise) {
      return json_({ ok: false, error: 'bad record' });
    }
    if (hasId(readRecords_(), r.id)) return json_({ ok: true, duplicate: true });
    getSheet_().appendRow([r.date, r.exercise, r.weight, r.reps, r.set, r.id]);
    return json_({ ok: true });
  }

  if (body.action === 'delete') {
    var sheet = getSheet_();
    for (var row = sheet.getLastRow(); row >= 2; row--) {
      if (String(sheet.getRange(row, 6).getValue()) === body.id) {
        sheet.deleteRow(row);
        return json_({ ok: true });
      }
    }
    return json_({ ok: false, error: 'not found' });
  }

  return json_({ ok: false, error: 'unknown action' });
}
