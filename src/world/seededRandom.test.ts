import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSeededRandom } from './seededRandom';
import { generateWorldBlueprint } from './worldBlueprint';

// Captured from all six original implementations before extracting the shared generator.
const legacyStreams: Array<[salt: number, seed: number, sha256: string]> = [
  [2654435769, 0, "5d449092320a529c81ac23a0f879c1a6314ff41e903b285809e398a8634bae9d"],
  [2654435769, 1, "1a02c70040d461226e660228c4641da758bf02f98f6d8fd5f6ed830a1c6353e3"],
  [2654435769, 2026, "dec2e04d8d21b00e15607c9e2bf8408accea4c8bd1bd67ccc0275ef5f75164ae"],
  [2654435769, -1, "2dc118361bc9c1dd391aca0d590945bea63ce86038caddf701cb74c5b0c41e96"],
  [2654435769, -2147483648, "f1ab6e88d64fc06dd81b4256d0417a40cbccf4e7408116d69173de9ab259ecae"],
  [2654435769, 2147483647, "c93cdecb43ce1b98a167eecc12010d84892835b3a33aacc2920dae639519cc96"],
  [2654435769, 4294967297, "1a02c70040d461226e660228c4641da758bf02f98f6d8fd5f6ed830a1c6353e3"],
  [2654435769, 9007199254740991, "2dc118361bc9c1dd391aca0d590945bea63ce86038caddf701cb74c5b0c41e96"],
  [0, 0, "1e3fec1a7a9f7b41ef83530b53ec6baa8dffe27d8819255014efb9b0141f7944"],
  [0, 1, "7f2a716f6834c475ab6959e0b712c39b1aadf292bd1ae74a364232f7e05f03ee"],
  [0, 2026, "c1338a7520ceb12f65fd7f92ef3c43885c5d129f9cc2c2abbfe990f9485e6864"],
  [0, -1, "e8d6a3879caddf0a778cb76a568de0c77325e9f71589147d49782c5b485755a9"],
  [0, -2147483648, "34c607ae40057f9ce4e1e4aa1f044e9f59120ece73ae4ee0d7ed8426380c1574"],
  [0, 2147483647, "7d9f569f33539ccb3ced45c3b88ed779dda2615c56e606dddca9e112e7c9babb"],
  [0, 4294967297, "7f2a716f6834c475ab6959e0b712c39b1aadf292bd1ae74a364232f7e05f03ee"],
  [0, 9007199254740991, "e8d6a3879caddf0a778cb76a568de0c77325e9f71589147d49782c5b485755a9"],
  [2246822507, 0, "e44594bc2abf6595def1388f4a35ebc634067e0816908bb86eb587d230e527cf"],
  [2246822507, 1, "d1d147bb7ea235c90daff884e3ddd1240c8a48b807b77d19c2b9a4eeb6a4e340"],
  [2246822507, 2026, "6c69378178e7bcc69ca80ca7d42b71da9139bfa012de5fbef31c13c5e7730dd1"],
  [2246822507, -1, "aaa19fa36b7149e9adca77424a0b2c02f60e06ff37f73fd08d50b66ad9f4f0b5"],
  [2246822507, -2147483648, "f4a9a8c08aca8084332440ea834b6b023c14a38d0ba68ed59b06c6167a426c59"],
  [2246822507, 2147483647, "aada61bb1a0f1f71262bc488ddfcf52295f2e1c67d34b9c87498e6dd3f3fae7e"],
  [2246822507, 4294967297, "d1d147bb7ea235c90daff884e3ddd1240c8a48b807b77d19c2b9a4eeb6a4e340"],
  [2246822507, 9007199254740991, "aaa19fa36b7149e9adca77424a0b2c02f60e06ff37f73fd08d50b66ad9f4f0b5"],
  [1367130551, 0, "64c5fd3a6b218078e190fb474bb7200082e43ca470eee28b0501d4e90fe36c8f"],
  [1367130551, 1, "7cc16c866aa1e10b50bb058975ec2553e42b7113eacaff303b22e1eaef6abc77"],
  [1367130551, 2026, "f797d21aae0c5af4fbe5e402c83b942ef2cdfcbb2dc6db3abb8955e94c23cef9"],
  [1367130551, -1, "1e67f636ae4750766513aa62ee59272f9f1a24acc4f0d3b9233a813b6f4cebfa"],
  [1367130551, -2147483648, "df17e9b971db21439bcf4766a94ca22e099a9ccbb66ce0794582a82671a6265b"],
  [1367130551, 2147483647, "008eff7b19d10c898c040c1214ef4ea634468d60f2b3af428e6b6cec2082271f"],
  [1367130551, 4294967297, "7cc16c866aa1e10b50bb058975ec2553e42b7113eacaff303b22e1eaef6abc77"],
  [1367130551, 9007199254740991, "1e67f636ae4750766513aa62ee59272f9f1a24acc4f0d3b9233a813b6f4cebfa"],
];
const blueprintTestSeeds = [0, 1, 2026, -1, -2147483648, 2147483647, 4294967297, 9007199254740991];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('world RNG preserves every legacy stream through seed coercion and repeated int32 overflow', () => {
  for (const [salt, seed, sha256] of legacyStreams) {
    const random = createSeededRandom(seed, salt);
    const values = Array.from({ length: 10000 }, () => random());
    assert.equal(hash(values), sha256, `salt ${salt}: seed ${seed}`);
  }
});

test('world blueprints are deterministic across repeated generation and differ across distinct seeds', () => {
  const seen = new Set<string>();
  for (const seed of blueprintTestSeeds) {
    const h1 = hash(generateWorldBlueprint(seed));
    const h2 = hash(generateWorldBlueprint(seed));
    assert.equal(h1, h2, `seed ${seed} must be deterministic`);
    seen.add(h1);
  }
  assert.ok(seen.size >= 6, `distinct seeds should produce distinct blueprints, got ${seen.size}`);
});

test('random streams are independent and do not remap zero to one', () => {
  const first = createSeededRandom(0);
  const second = createSeededRandom(0);
  const expected = second();
  assert.equal(first(), expected);
  for (let i = 0; i < 100; i++) first();
  assert.equal(createSeededRandom(0)(), expected);
  assert.notEqual(createSeededRandom(1)(), expected);
});
