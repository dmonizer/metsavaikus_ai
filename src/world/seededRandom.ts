/** Independent Mulberry32 stream. Salt and int32 overflow preserve legacy world generation. */
export function createSeededRandom(seed: number, salt = 0): () => number {
  let state = (seed | 0) ^ salt;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
