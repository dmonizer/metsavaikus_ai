const GAMEPLAY_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'ShiftLeft', 'ShiftRight', 'Space',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'KeyE', 'KeyF', 'KeyR', 'KeyL', 'KeyJ', 'KeyT', 'KeyY', 'KeyG', 'KeyH',
]);
const OVERLAY_KEYS = new Set(['Tab', 'KeyB', 'KeyM', 'KeyP', 'Escape', 'F8', 'F9']);
const PAUSED_KEYS = new Set(['KeyP', 'Escape', 'F8', 'F9']);
const EDITOR_SHORTCUTS = new Set(['Escape', 'F8', 'F9']);

export interface GameKeyboardContext {
  phase: string;
  modalOpen: boolean;
  pointerLocked: boolean;
}

/** Claim only game controls; leave browser shortcuts and native UI editing alone. */
export function consumeGameKeyDown(event: KeyboardEvent, context: GameKeyboardContext): boolean {
  if (event.defaultPrevented || event.isComposing || event.key === 'Dead' ||
      event.ctrlKey || event.altKey || event.metaKey) return false;
  if (context.phase !== 'playing' && context.phase !== 'paused') return false;
  const code = event.code;
  if (!GAMEPLAY_KEYS.has(code) && !OVERLAY_KEYS.has(code)) return false;
  if (code === 'Escape' && context.pointerLocked) return false;

  const target = event.target as HTMLElement | null;
  const nativeUiTarget = target?.isContentEditable || target?.closest?.(
    'input, textarea, select, button, [role="button"], [role="textbox"], [role="combobox"], [role="slider"]'
  );
  if (nativeUiTarget && !EDITOR_SHORTCUTS.has(code)) return false;
  if (context.phase === 'paused' && !PAUSED_KEYS.has(code)) return false;
  if (context.modalOpen && !OVERLAY_KEYS.has(code)) return false;

  // Cancelling keydown suppresses browser defaults such as Firefox quick find,
  // arrow-key page scrolling and Space activation while the game owns the key.
  event.preventDefault();
  return true;
}
