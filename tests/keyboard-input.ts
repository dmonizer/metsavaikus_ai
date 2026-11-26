import { consumeGameKeyDown, type GameKeyboardContext } from '../src/game/keyboardInput';

const state = {
  ready: true,
  enabled: true,
  context: { phase: 'playing', modalOpen: false, pointerLocked: false } as GameKeyboardContext,
  handled: [] as string[],
  events: [] as Array<{ code: string; prevented: boolean; trusted: boolean; ctrl: boolean }>,
  buttonClicks: 0,
};
(window as unknown as { keyboardTest: typeof state }).keyboardTest = state;
window.addEventListener('keydown', event => {
  if (state.enabled && consumeGameKeyDown(event, state.context)) state.handled.push(event.code);
  state.events.push({ code: event.code, prevented: event.defaultPrevented, trusted: event.isTrusted, ctrl: event.ctrlKey });
});
document.getElementById('button')!.addEventListener('click', () => state.buttonClicks++);
