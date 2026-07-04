// 외부 라이브러리 없는 SVG 꺾은선 차트 (Apple Health 스타일 — 영역 그라디언트 + 목표 점선).

export function scalePoints(series, width, height, pad = 30, extra = []) {
  if (!series.length) return [];
  const values = series.map((p) => p.weight)
    .concat(extra.filter((v) => v !== null && v !== undefined));
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = series.length > 1 ? innerW / (series.length - 1) : 0;
  const y = (v) => pad + innerH - ((v - min) / span) * innerH;
  const pts = series.map((p, i) => ({
    ...p,
    x: pad + (series.length > 1 ? i * step : innerW / 2),
    y: y(p.weight),
  }));
  pts.scaleY = y; // renderChart가 목표선 y좌표 계산에 사용
  return pts;
}

let chartSeq = 0; // 페이지 내 그라디언트 id 충돌 방지

export function renderChart(el, series, opts = {}) {
  const W = 340;
  const H = 220;
  const pad = 30;
  if (!series.length) {
    el.innerHTML = '<p class="chart-empty">기록이 쌓이면 여기에 변화가 보여요</p>';
    return;
  }
  const goal = opts.goal === null || opts.goal === undefined ? null : Number(opts.goal);
  const pts = scalePoints(series, W, H, pad, goal === null ? [] : [goal]);
  const baseline = H - pad;
  const linePts = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const areaPts = `${pts[0].x},${baseline} ${linePts} ${pts[pts.length - 1].x},${baseline}`;
  const gid = `wg${(chartSeq += 1)}`;
  const dots = pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="2.5"></circle>`).join('');

  // 마지막 값은 알약으로 강조 (Health 앱처럼)
  const last = pts[pts.length - 1];
  const px = Math.max(pad + 22, Math.min(last.x, W - pad - 22));
  const py = Math.max(16, last.y - 18);
  const pill =
    `<g class="pill"><rect x="${px - 22}" y="${py - 13}" width="44" height="20" rx="10"></rect>` +
    `<text class="pill-t" x="${px}" y="${py + 1}" text-anchor="middle">${last.weight}</text></g>`;

  let goalEls = '';
  if (goal !== null) {
    const gy = pts.scaleY(goal);
    goalEls =
      `<line class="goal" x1="${pad}" y1="${gy}" x2="${W - pad}" y2="${gy}" stroke-dasharray="2,4"></line>` +
      `<text class="goal-t" x="${W - pad}" y="${gy - 5}" text-anchor="end">목표 ${goal}</text>`;
  }

  const first = series[0].date.slice(5).replace('-', '.');
  const lastD = series[series.length - 1].date.slice(5).replace('-', '.');
  el.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="변화 차트">` +
    `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop class="g0" offset="0"></stop><stop class="g1" offset="1"></stop></linearGradient></defs>` +
    `<polygon class="area" points="${areaPts}" fill="url(#${gid})"></polygon>` +
    goalEls +
    `<polyline class="line" points="${linePts}" fill="none"></polyline>` +
    dots + pill +
    `<text class="axis" x="${pad}" y="${H - 8}">${first}</text>` +
    `<text class="axis" x="${W - pad}" y="${H - 8}" text-anchor="end">${lastD}</text>` +
    '</svg>';
}
