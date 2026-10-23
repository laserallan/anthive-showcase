// The playback clock every lens reads: the current frame `t`, play/pause and speed. While playing
// with smoothing on, `time` also carries how far playback is towards the next frame, so a lens
// can move ants smoothly between steps; lenses that draw whole frames read `t`.

export const SPEEDS = [1, 2, 5, 10, 20, 30, 60, 120];

// `frames()` is the number of frames of the open episode (0 when none is open); `onChange` runs
// after every change of frame, play state, speed or smoothing.
export function createClock(frames, onChange) {
  const clock = { t: 0, playing: false, speed: 30, smooth: true };
  let last = performance.now(), acc = 0;

  Object.defineProperty(clock, 'time', {
    get: () => clock.t + (clock.playing && clock.smooth && clock.t < frames() - 1 ? Math.min(acc, 1) : 0),
  });
  clock.setT = t => {
    if (!frames()) return;
    clock.t = Math.max(0, Math.min(frames() - 1, t)); onChange();
  };
  clock.setSpeed = d => {
    clock.speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(clock.speed) + d))]; onChange();
  };
  clock.toggle = () => {
    if (!frames()) return;
    if (clock.t >= frames() - 1) clock.t = 0;
    clock.playing = !clock.playing; last = performance.now(); acc = 0; onChange();
  };
  clock.toggleSmooth = () => { clock.smooth = !clock.smooth; onChange(); };

  function tick(now) {
    if (clock.playing && frames()) {
      acc += Math.max(0, now - last) / 1000 * clock.speed;  // a frame's timestamp can precede a toggle in it
      const n = Math.floor(acc);
      if (n > 0) { acc -= n; if (clock.t + n >= frames() - 1) clock.playing = false; clock.setT(clock.t + n); }
    }
    last = now; requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  return clock;
}
