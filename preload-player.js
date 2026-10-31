'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  search: (keyword, page) => ipcRenderer.invoke('bili:search', keyword, page),
  resolve: (bvid) => ipcRenderer.invoke('bili:resolve', bvid),
  audio: (bvid, cid) => ipcRenderer.invoke('bili:audio', bvid, cid),
  authState: () => ipcRenderer.invoke('auth:state'),
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  lyrics: (q) => ipcRenderer.invoke('lyrics:get', q),
  favFolders: () => ipcRenderer.invoke('bili:fav-folders'),
  favList: (mediaId, pn) => ipcRenderer.invoke('bili:fav-list', mediaId, pn),
  openExternal: (url) => ipcRenderer.invoke('bili:open-external', url),
  storeAll: () => ipcRenderer.invoke('store:all'),
  storeSet: (key, value) => ipcRenderer.invoke('store:set', key, value),
  applySettings: (patch) => ipcRenderer.invoke('settings:apply', patch),
  setPlayback: (state) => ipcRenderer.send('playback:update', state),
  setLyricLine: (text) => ipcRenderer.send('lyric:line', text),
  hide: () => ipcRenderer.send('player:hide'),
  minimize: () => ipcRenderer.send('player:minimize'),
  onCommand: (cb) => ipcRenderer.on('command', (_e, cmd) => cb(cmd)),
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, patch) => cb(patch)),
});
