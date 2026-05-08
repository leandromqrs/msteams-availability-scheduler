import gulp from 'gulp';
import zip from 'gulp-zip';
import uglify from 'gulp-uglify';
import { createRequire } from 'module';
import { readFileSync, existsSync, writeFileSync, rmSync } from 'fs';
import { resolve } from 'path';

const require = createRequire(import.meta.url);

const JS_SRC = ['src/js/**'];
const STATIC_SRC = ['manifest.json', 'src/css/**', 'src/html/**', 'src/images/**'];
const UNPACKED = 'production/unpacked';

function clean(done) {
  if (existsSync('production')) rmSync('production', { recursive: true, force: true });
  done();
}

const copyJs = () =>
  gulp.src(JS_SRC, { base: '.' })
    .pipe(uglify())
    .pipe(gulp.dest(UNPACKED));

const copyStatic = () =>
  gulp.src(STATIC_SRC, { base: '.' })
    .pipe(gulp.dest(UNPACKED));

const buildZip = () =>
  gulp.src(`${UNPACKED}/**`, { base: UNPACKED })
    .pipe(zip('extension.zip'))
    .pipe(gulp.dest('production'));

async function buildCrx() {
  const keyPath = process.env.CRX_KEY_PATH || 'key.pem';
  if (!existsSync(keyPath)) {
    console.log(`[CRX] No key at "${keyPath}" – skipping CRX build`);
    return;
  }
  const CRX = require('crx');
  const crx = new CRX({ privateKey: readFileSync(keyPath) });
  await crx.load(resolve(UNPACKED));
  const buf = await crx.pack();
  writeFileSync('production/extension.crx', buf);
  console.log('[CRX] Built: production/extension.crx');
}

export default gulp.series(
  clean,
  gulp.parallel(copyJs, copyStatic),
  gulp.parallel(buildZip, buildCrx),
);
