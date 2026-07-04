// 외부 라이브러리 없는 SVG 꺾은선 차트.

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

export function renderChart(el, series, opts = {}) {
  const W = 340;
  const H = 220;
  if (!series.length) {
    el.innerHTML = '<p class="muted">아직 기록이 없어요</p>';
    return;
  }
  const goal = opts.goal === null || opts.goal === undefined ? null : Number(opts.goal);
  const pts = scalePoints(series, W, H, 30, goal === null ? [] : [goal]);
  const line = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const dots = pts.map((p) =>
    `<circle cx="${p.x}" cy="${p.y}" r="4"></circle>` +
    `<text x="${p.x}" y="${p.y - 10}" text-anchor="middle">${p.weight}</text>`,
  ).join('');
  const first = series[0].date.slice(5);
  const last = series[series.length - 1].date.slice(5);
  let goalLine = '';
  if (goal !== null) {
    const gy = pts.scaleY(goal);
    goalLine =
      `<line x1="30" y1="${gy}" x2="${W - 30}" y2="${gy}" class="goal" stroke-dasharray="5,4"></line>` +
      `<text x="${W - 28}" y="${gy - 4}" text-anchor="end">목표 ${goal}</text>`;
  }
  el.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="변화 차트">` +
    `${goalLine}<polyline points="${line}" fill="none"></polyline>${dots}` +
    `<text x="30" y="${H - 8}">${first}</text>` +
    `<text x="${W - 30}" y="${H - 8}" text-anchor="end">${last}</text>` +
    '</svg>';
}
