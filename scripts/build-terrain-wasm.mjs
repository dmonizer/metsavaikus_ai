import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'mets-terrain-wasm-'));
try {
  const binary = join(temp, 'terrain.wasm');
  execFileSync('rustc', ['--edition=2021', '--target=wasm32-unknown-unknown', '--crate-type=cdylib',
    '-Copt-level=3', '-Clto', '-Cpanic=abort', '-Cstrip=symbols', '-Clink-arg=-zstack-size=65536',
    'wasm/terrain.rs', '-o', binary], { cwd: root, stdio: 'inherit' });
  const bytes = readFileSync(binary);
  const module = new WebAssembly.Module(bytes);
  if (WebAssembly.Module.imports(module).length) throw Error('Expected a self-contained terrain module');
  // Embed the small compiled binary so the browser, module worker and Node tests load identical bytes.
  const generated = '// Generated from wasm/terrain.rs by npm run build:wasm.\n' +
    'export const terrainWasmBase64 = ' + JSON.stringify(bytes.toString('base64')) + ';\n';
  writeFileSync(join(root, 'src/world/generated/terrainWasm.ts'), generated);
  console.log('Compiled terrain WebAssembly (' + bytes.length + ' bytes)');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
