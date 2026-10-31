'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  cookie: '',
  favorites: [],
  volume: 0.8,
  mode: 'order',
  petScale: 1,
  petAlwaysOnTop: true,
  showPet: true,
  quality: 'high',
  listenTotal: 0,
  listenToday: 0,
  listenDate: '',
  listenWave: 0,
  petLevel: 1,
  petExp: 0,
  listenHistory: {},
};

class Store {
  constructor(file) {
    this.file = file;
    this.data = { ...DEFAULTS };
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.data = { ...DEFAULTS, ...raw };
      }
    } catch (e) {
      console.warn('[store] 读取失败，使用默认值:', e.message);
    }
    this._timer = null;
  }

  get all() {
    return this.data;
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this._schedule();
  }

  merge(patch) {
    Object.assign(this.data, patch || {});
    this._schedule();
  }

  _schedule() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.warn('[store] 写入失败:', e.message);
    }
  }
}

module.exports = { Store, DEFAULTS };
