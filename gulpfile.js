import gulp from 'gulp';
import zip from 'gulp-zip';
import uglify from 'gulp-uglify';
import { createRequire } from 'module';
import { readFileSync, existsSync, writeFileSync, rmSync } from 'fs';
import { resolve } from 'path';

const require = createRequire(import.meta.url);

const manifest = JSON.parse(readFileSync('manifest.json', 'utf-8'));
const pkg      = JSON.parse(readFileSync('package.json', 'utf-8'));
const SLUG     = pkg.name;
const BUILD_NAME = `${SLUG}-${manifest.version}`;

const JS_SRC = ['src/js/**'];
const STATIC_SRC = ['manifest.json', '_locales/**', 'src/css/**', 'src/html/**', 'src/images/**'];
const UNPACKED = `dist/${BUILD_NAME}`;

function clean(done) {
  if (existsSync('dist')) rmSync('dist', { recursive: true, force: true });
  done();
}

const copyJs = () =>
  gulp.src(JS_SRC, { base: '.' })
    .pipe(uglify())
    .pipe(gulp.dest(UNPACKED));

const copyStatic = () =>
  gulp.src(STATIC_SRC, { base: '.', encoding: false })
    .pipe(gulp.dest(UNPACKED));

const buildZip = () =>
  gulp.src(`${UNPACKED}/**`, { base: UNPACKED, encoding: false })
    .pipe(zip(`${BUILD_NAME}.zip`))
    .pipe(gulp.dest('dist'));

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
  writeFileSync(`dist/${BUILD_NAME}.crx`, buf);
  console.log(`[CRX] Built: dist/${BUILD_NAME}.crx`);
}

export default gulp.series(
  clean,
  gulp.parallel(copyJs, copyStatic),
  gulp.parallel(buildZip, buildCrx),
);
