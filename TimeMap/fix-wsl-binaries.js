#!/usr/bin/env node
/**
 * Downloads Linux x64 native binaries that Windows npm installs incorrectly.
 * Run this once after `npm install` in frontend/ or backend/ on WSL.
 *
 * Usage:
 *   node fix-wsl-binaries.js          # fixes both frontend and backend
 *   node fix-wsl-binaries.js frontend # fixes frontend only
 *   node fix-wsl-binaries.js backend  # fixes backend only
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { execSync } = require('child_process');

function download(url, dest, stripComponents = 1) {
  return new Promise((resolve, reject) => {
    const tmp = `/tmp/${path.basename(dest)}-${Date.now()}.tgz`;
    fs.mkdirSync(dest, { recursive: true });
    const out = fs.createWriteStream(tmp);
    https.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(out);
      out.on('finish', () => {
        out.close();
        execSync(`tar -xzf ${tmp} -C ${dest} --strip-components=${stripComponents}`, { stdio: 'inherit' });
        fs.unlinkSync(tmp);
        resolve();
      });
    }).on('error', reject);
  });
}

function pkgVersion(pkgJsonPath) {
  return JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')).version;
}

async function fixFrontend() {
  const base = path.join(__dirname, 'frontend', 'node_modules');

  // esbuild (used by Vite)
  const esbuildVer = pkgVersion(path.join(base, 'esbuild', 'package.json'));
  console.log(`[frontend] esbuild ${esbuildVer} → installing linux-x64`);
  await download(
    `https://registry.npmjs.org/@esbuild/linux-x64/-/linux-x64-${esbuildVer}.tgz`,
    path.join(base, '@esbuild', 'linux-x64'),
  );

  // rollup (used by Vite)
  const rollupVer = pkgVersion(path.join(base, 'rollup', 'package.json'));
  console.log(`[frontend] rollup ${rollupVer} → installing linux-x64-gnu`);
  await download(
    `https://registry.npmjs.org/@rollup/rollup-linux-x64-gnu/-/rollup-linux-x64-gnu-${rollupVer}.tgz`,
    path.join(base, '@rollup', 'rollup-linux-x64-gnu'),
  );

  console.log('[frontend] done');
}

async function fixBackend() {
  // backend has no native modules — nothing to fix
  console.log('[backend] no native binaries to fix (pure JS stack)');
}

async function main() {
  const target = process.argv[2] ?? 'both';
  if (target === 'frontend' || target === 'both') await fixFrontend();
  if (target === 'backend'  || target === 'both') await fixBackend();
}

main().catch(err => { console.error(err); process.exit(1); });
