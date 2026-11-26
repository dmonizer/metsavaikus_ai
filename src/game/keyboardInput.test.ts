import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeGameKeyDown, type GameKeyboardContext } from './keyboardInput';

const playing: GameKeyboardContext = { phase: 'playing', modalOpen: false, pointerLocked: false };
function key(code: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return Object.assign(new Event('keydown', { cancelable: true }), {
    code, key: code, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, ...extra,
  }) as KeyboardEvent;
}

test('game movement, interaction and overlay controls cancel browser defaults including repeats', () => {
  for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'Space', 'ShiftLeft', 'ArrowUp',
    'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyE', 'KeyF', 'KeyR', 'KeyL', 'KeyJ', 'KeyT',
    'KeyY', 'KeyG', 'KeyH', 'KeyB', 'KeyM', 'KeyP', 'Tab', 'F8', 'F9']) {
    for (const repeat of [false, true]) {
      const event = key(code, { repeat });
      assert.equal(consumeGameKeyDown(event, playing), true, code);
      assert.equal(event.defaultPrevented, true, code);
    }
  }
});

test('browser shortcuts, composing/dead keys, already-handled and unbound keys are left alone', () => {
  for (const extra of [{ ctrlKey: true }, { altKey: true }, { metaKey: true },
    { isComposing: true }, { key: 'Dead' }]) {
    const event = key('KeyW', extra);
    assert.equal(consumeGameKeyDown(event, playing), false);
    assert.equal(event.defaultPrevented, false);
  }
  const handled = key('KeyW'); handled.preventDefault();
  assert.equal(consumeGameKeyDown(handled, playing), false);
  for (const code of ['KeyQ', 'F5', 'F7', 'F11', 'Enter']) {
    const event = key(code);
    assert.equal(consumeGameKeyDown(event, playing), false);
    assert.equal(event.defaultPrevented, false);
  }
});

test('inactive phases and overlays preserve UI keyboard behavior', () => {
  for (const phase of ['title', 'packing', 'sleeping', 'collapsing', 'collapsed', 'paused']) {
    const event = key('KeyW');
    assert.equal(consumeGameKeyDown(event, { ...playing, phase }), false);
    assert.equal(event.defaultPrevented, false);
  }
  assert.equal(consumeGameKeyDown(key('KeyW'), { ...playing, modalOpen: true }), false);
  assert.equal(consumeGameKeyDown(key('F9'), { ...playing, modalOpen: true }), true);
  assert.equal(consumeGameKeyDown(key('KeyP'), { ...playing, phase: 'paused' }), true);
});

test('Escape can close game UI but remains available to exit native pointer lock', () => {
  assert.equal(consumeGameKeyDown(key('Escape'), playing), true);
  const escape = key('Escape');
  assert.equal(consumeGameKeyDown(escape, { ...playing, pointerLocked: true }), false);
  assert.equal(escape.defaultPrevented, false);
});
