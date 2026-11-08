'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { minify } = require('terser');

async function main() {
  const srcPath = path.join(__dirname, '..', 'aihttp.js');
  const outPath = path.join(__dirname, '..', 'aihttp.min.js');
  const source = fs.readFileSync(srcPath, 'utf8');
  const result = await minify(source, {
    compress: { passes: 2, unsafe: false },
    mangle: true,
    format: { comments: /^!/ }
  });
  if (!result.code) throw new Error('minification produced no output');
  fs.writeFileSync(outPath, result.code + '\n', 'utf8');
  const raw = Buffer.byteLength(source, 'utf8');
  const min = Buffer.byteLength(result.code, 'utf8');
  const gzip = zlib.gzipSync(Buffer.from(result.code, 'utf8'), { level: 9 }).length;
  process.stdout.write('aihttp.js     ' + raw + ' bytes\n');
  process.stdout.write('aihttp.min.js ' + min + ' bytes (' + gzip + ' gzip)\n');
  process.stdout.write('ratio        ' + (Math.round((min / raw) * 1000) / 10) + '%\n');
}

main().catch((err) => {
  process.stderr.write('build failed: ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(1);
});
