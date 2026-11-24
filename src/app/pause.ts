import type { Loop } from './loop';

/** Pauses on blur or hidden tab and stays paused on return. Owns the banner. */
export function attachPause(loop: Loop): void {
  const banner = document.getElementById('pause-banner');
  const button = document.getElementById('pause-resume');
  const show = (paused: boolean): void => {
    if (banner) banner.hidden = !paused;
  };
  loop.onPausedChange = show;
  show(loop.paused);

  window.addEventListener('blur', () => loop.pause());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loop.pause();
  });
  button?.addEventListener('click', () => {
    loop.resume();
    button.blur();
  });
}
