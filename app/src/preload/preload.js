// preload：只開放介面需要的最小 API（sandbox 模式，不能 require 本地模組）
'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const on = (ch) => (fn) => {
  const listener = (_e, ...args) => fn(...args);
  ipcRenderer.on(ch, listener);
  return () => ipcRenderer.removeListener(ch, listener);
};

contextBridge.exposeInMainWorld('pget', {
  init: invoke('app:init'),
  tasks: {
    add: invoke('tasks:add'),
    pause: invoke('tasks:pause'),
    resume: invoke('tasks:resume'),
    retry: invoke('tasks:retry'),
    remove: invoke('tasks:remove'),
    pauseAll: invoke('tasks:pauseAll'),
    resumeAll: invoke('tasks:resumeAll'),
    clearCompleted: invoke('tasks:clearCompleted'),
    openFile: invoke('tasks:openFile'),
    openFolder: invoke('tasks:openFolder'),
  },
  probeVideo: invoke('video:probe'),
  pickFolder: invoke('dialog:pickFolder'),
  pickTorrent: invoke('dialog:pickTorrent'),
  setSettings: invoke('settings:set'),
  revokeClient: invoke('settings:revoke'),
  checkUpdate: invoke('update:check'),
  openExternal: invoke('shell:openExternal'),
  // 拖放檔案取得本機路徑（Electron 32+ 不再有 File.path）
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
  onTasks: on('tasks:update'),
  onEngines: on('engines:update'),
  onSettings: on('settings:update'),
  onI18n: on('i18n:update'),
  onUpdate: on('update:available'),
});
