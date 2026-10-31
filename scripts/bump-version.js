#!/usr/bin/env node
'use strict';

/**
 * 版本号自增：node scripts/bump-version.js patch|minor|major
 * 只改 package.json 的 version 字段，保持 2 空格缩进与结尾换行。
 */
const fs = require('fs');
const path = require('path');

const bump = process.argv[2] || 'patch';
const file = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

const parts = String(pkg.version || '1.0.0').split('.').map((n) => parseInt(n, 10) || 0);
let [major, minor, patch] = parts;

if (bump === 'major') {
  major += 1; minor = 0; patch = 0;
} else if (bump === 'minor') {
  minor += 1; patch = 0;
} else if (bump === 'patch') {
  patch += 1;
} else {
  console.error('用法: node scripts/bump-version.js patch|minor|major');
  process.exit(2);
}

const from = pkg.version;
pkg.version = `${major}.${minor}.${patch}`;
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`${from} -> ${pkg.version}`);
