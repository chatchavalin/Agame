#!/usr/bin/env node
/**
 * A-Math — Quick Syntax Check
 * Run: node tests/syntax-check.js
 * 
 * Parses all JS files without launching a browser.
 * Fast (<1s) — run before every commit.
 */

const fs = require('fs');
const path = require('path');

const jsDir = path.join(__dirname, '..', 'js');
const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));

let errors = 0;
let total = 0;

for (const f of files) {
  total++;
  const code = fs.readFileSync(path.join(jsDir, f), 'utf8');
  try {
    new Function(code);
    // Also check for common bugs
    const issues = [];
    if (code.includes('validation.valid') && !code.includes('// validation.valid')) {
      issues.push('⚠️  Uses validation.valid (should be validation.ok?)');
    }
    if (code.includes('Scoring.computeScore') && !code.includes('// Scoring.computeScore')) {
      issues.push('⚠️  Uses Scoring.computeScore (should be Scoring.scorePlay?)');
    }
    if (issues.length) {
      console.log(`⚠️  ${f}: syntax OK but ${issues.length} warning(s)`);
      issues.forEach(i => console.log(`     ${i}`));
    }
  } catch (err) {
    errors++;
    console.log(`❌ ${f}: ${err.message}`);
  }
}

if (errors === 0) {
  console.log(`✅ All ${total} JS files parse clean`);
} else {
  console.log(`\n❌ ${errors}/${total} files have syntax errors`);
}
process.exit(errors);
