/**
 * tests/run.js — runs every *.test.js in this folder and reports the overall result.
 * Usage:  node tests/run.js     (or: npm test)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();

let failedFiles = 0;
for (const f of files) {
  try {
    const out = execFileSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8' });
    process.stdout.write(out);
  } catch (e) {
    // non-zero exit (some checks failed) — still print its output
    if (e.stdout) process.stdout.write(e.stdout);
    if (e.stderr) process.stderr.write(e.stderr);
    failedFiles++;
  }
}

console.log('\n' + (failedFiles
  ? '\u274c ' + failedFiles + ' test file(s) had failures'
  : '\u2705 all test files passed'));
process.exit(failedFiles ? 1 : 0);
