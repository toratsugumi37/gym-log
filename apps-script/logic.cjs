// 순수 함수 모음 — Google Apps Script에 그대로 복붙되고, Node 테스트에서도 로드된다.
// GAS 호환을 위해 var/function 문법만 사용한다.

function rowsToRecords(rows) {
  return rows.map(function (r) {
    return {
      date: String(r[0]),
      exercise: String(r[1]),
      weight: Number(r[2]),
      reps: Number(r[3]),
      set: Number(r[4]),
      id: String(r[5]),
    };
  });
}

function recordsOnDate(records, date) {
  return records.filter(function (r) { return r.date === date; });
}

function lastSession(records, exercise, beforeDate) {
  var dates = records
    .filter(function (r) { return r.exercise === exercise && r.date < beforeDate; })
    .map(function (r) { return r.date; });
  if (dates.length === 0) return [];
  var last = dates.sort()[dates.length - 1];
  return records.filter(function (r) {
    return r.exercise === exercise && r.date === last;
  });
}

function recentExercises(records) {
  var seen = {};
  var out = [];
  for (var i = records.length - 1; i >= 0; i--) {
    var name = records[i].exercise;
    if (!seen[name]) {
      seen[name] = true;
      out.push(name);
    }
  }
  return out;
}

function chartSeries(records, exercise) {
  var byDate = {};
  records.forEach(function (r) {
    if (r.exercise !== exercise) return;
    if (byDate[r.date] === undefined || r.weight > byDate[r.date]) {
      byDate[r.date] = r.weight;
    }
  });
  return Object.keys(byDate).sort().map(function (d) {
    return { date: d, weight: byDate[d] };
  });
}

function hasId(records, id) {
  return records.some(function (r) { return r.id === id; });
}

if (typeof module !== 'undefined') {
  module.exports = {
    rowsToRecords: rowsToRecords,
    recordsOnDate: recordsOnDate,
    lastSession: lastSession,
    recentExercises: recentExercises,
    chartSeries: chartSeries,
    hasId: hasId,
  };
}
