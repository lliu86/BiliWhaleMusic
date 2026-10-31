'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  setInteractive: (yes) => ipcRenderer.send('pet:interactive', yes),
  over: () => ipcRenderer.send('pet:over'),
  dragStart: (point) => ipcRenderer.send('pet:drag-start', point),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  openPlayer: () => ipcRenderer.send('pet:open-player'),
  contextMenu: () => ipcRenderer.send('pet:context-menu'),
  command: (cmd) => ipcRenderer.send('pet:command', cmd),
  panel: (open) => ipcRenderer.send('pet:panel', open),
  onPanel: (cb) => ipcRenderer.on('pet:panel', (_e, open) => cb(open)),
  onStats: (cb) => ipcRenderer.on('pet:stats', (_e, stats) => cb(stats)),
  onAction: (cb) => ipcRenderer.on('pet:action', (_e, action) => cb(action)),
  onPlayback: (cb) => ipcRenderer.on('playback', (_e, state) => cb(state)),
  onScale: (cb) => ipcRenderer.on('pet:scale', (_e, scale) => cb(scale)),
  danmaku: (bvid, cid) => ipcRenderer.invoke('pet:danmaku', bvid, cid),
  onLyricLine: (cb) => ipcRenderer.on('lyric:line', (_e, text) => cb(text)),
  onBeat: (cb) => ipcRenderer.on('pet:beat', (_e, v) => cb(v)),
  onFlashback: (cb) => ipcRenderer.on('pet:flashback', (_e, data) => cb(data)),
});
