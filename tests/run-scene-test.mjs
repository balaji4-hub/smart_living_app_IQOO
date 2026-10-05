/**
 * Compiles the pure three.js scene modules to CommonJS and runs the headless
 * scene test, so the 3D floor plan is verified without a device.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const mobile = join(root, 'mobile');
const outDir = join(root, 'tests', '.build');

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const tsc = join(mobile, 'node_modules', 'typescript', 'bin', 'tsc');

try {
  execFileSync(
    process.execPath,
    [
      tsc,
      'src/three/homeScene.ts',
      'src/three/sceneParts.ts',
      'src/three/orbit.ts',
      '--ignoreConfig',
      '--outDir',
      outDir,
      '--module',
      'commonjs',
      '--target',
      'es2020',
      '--moduleResolution',
      'node',
      '--skipLibCheck',
      '--esModuleInterop',
      '--jsx',
      'react-jsx',
      '--ignoreDeprecations',
      '6.0',
    ],
    { cwd: mobile, stdio: 'pipe' },
  );
} catch (error) {
  const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  // TS6059/TS2307 style complaints are fine: we only need the emitted JS.
  if (!existsSync(join(outDir, 'three', 'homeScene.js'))) {
    console.error(output);
    process.exit(1);
  }
}

// The compiled output lives outside the mobile package, so link node_modules in
// to keep `require('three')` resolvable.
symlinkSync(join(mobile, 'node_modules'), join(outDir, 'node_modules'), 'dir');

execFileSync(process.execPath, [join(root, 'tests', 'scene.test.cjs')], {
  stdio: 'inherit',
  env: { ...process.env, SL_SCENE_BUILD: outDir },
});