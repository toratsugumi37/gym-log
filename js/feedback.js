// 세트 추가 시 피드백. iOS는 진동 API가 막혀 no-op → 사운드/시각으로 대체.

let audioCtx;

export function feedbackAdd() {
  try { if (navigator.vibrate) navigator.vibrate(8); } catch { /* 무시 */ }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    const now = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.05, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(now);
    o.stop(now + 0.13);
  } catch { /* 무시 */ }
}
