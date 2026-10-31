'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  screen,
  globalShortcut,
  session,
  shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { BiliClient } = require('./src/bili');
const { LyricsClient } = require('./src/lyrics');
const { Store } = require('./src/store');

// 开发时日志与截图写在项目目录；打包后（asar 只读）落到 userData。
// 用「能不能在 __dirname 写文件」来判断，比 app.isPackaged 稳（改名后的 runtime 也能正确落盘）。
let cachedDataDir = null;
function dataDir() {
  if (cachedDataDir) return cachedDataDir;
  try {
    const probe = path.join(__dirname, '.write-probe');
    fs.writeFileSync(probe, '1');
    fs.unlinkSync(probe);
    cachedDataDir = __dirname;
  } catch (_) {
    try {
      cachedDataDir = app.getPath('userData');
    } catch (_2) {
      cachedDataDir = os.tmpdir();
    }
  }
  return cachedDataDir;
}
function log(...args) {
  try {
    fs.appendFileSync(path.join(dataDir(), 'startup.log'), `[${new Date().toISOString()}] ${args.join(' ')}\n`);
  } catch (_) {}
}
log('--- boot', process.argv.join(' '));

process.on('uncaughtException', (err) => {
  log('UNCAUGHT', err && err.stack ? err.stack : String(err));
});
process.on('unhandledRejection', (err) => {
  log('REJECTION', err && err.stack ? err.stack : String(err));
});

const ASSETS = path.join(__dirname, 'assets');
const PET_W = 240;
const PET_PANEL_W = 200;
const PET_H = 420;

let playerWin = null;
let petWin = null;
let tray = null;
let quitting = false;

let store = null;
const bili = new BiliClient();
const lyricClient = new LyricsClient();

/** 播放状态（由渲染进程同步过来，供托盘/宠物/快捷键使用） */
const playback = {
  playing: false,
  title: '',
  artist: '',
  cover: '',
  position: 0,
  duration: 0,
};

/** 桌宠状态：固定站位，只允许拖动 */
const pet = {
  x: 0,
  y: 0,
  scale: 1,
  dragging: false,
  dragOffset: { x: 0, y: 0 },
  dragTimer: null,
  traceTick: 0,
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* ------------------------------------------------------------------ */
/* 应用初始化                                                          */
/* ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  log('single instance lock: false -> quit');
  app.quit();
} else {
  log('single instance lock: true');
  app.on('second-instance', () => showPlayer());
}

app.setAppUserModelId('com.biuwhale.app');

// 透明置顶小窗在部分虚拟机 / 远程桌面里用 GPU 合成会花屏或不可见，关掉硬件加速更稳
app.disableHardwareAcceleration();

app.on('before-quit', () => {
  try {
    if (store && bili.getCookie()) store.set('cookie', bili.getCookie());
  } catch (_) {
    /* ignore */
  }
});

app.whenReady().then(() => {
  log('app ready, userData=', app.getPath('userData'));
  store = new Store(path.join(app.getPath('userData'), 'biuwhale.json'));
  bili.setCookie(store.get('cookie'));

  // 统一 UA + 媒体请求补 Referer，否则 B 站 CDN 会 403
  const ses = session.defaultSession;
  ses.setUserAgent(UA);
  ses.webRequest.onBeforeSendHeaders(
    {
      urls: [
        '*://*.bilivideo.com/*',
        '*://*.bilivideo.cn/*',
        '*://*.hdslb.com/*',
        '*://*.bilibili.com/*',
      ],
    },
    (details, callback) => {
      const headers = details.requestHeaders;
      headers['Referer'] = 'https://www.bilibili.com/';
      headers['Origin'] = 'https://www.bilibili.com';
      headers['User-Agent'] = UA;
      callback({ requestHeaders: headers });
    }
  );

  createPlayer();
  createPet();
  startWidgetStats();
  createTray();
  registerShortcuts();
  log('windows created');

  // 听歌时光机：启动 3 分钟后看一次，之后每小时一次
  setTimeout(checkFlashback, 3 * 60 * 1000);
  setInterval(checkFlashback, 60 * 60 * 1000);

  if (process.argv.includes('--shot')) {
    setTimeout(captureShots, 4000);
  }

  app.on('activate', () => showPlayer());
});

/* ------------------------------------------------------------------ */
/* 桌宠组件：系统状态采样（CPU / 内存）                                  */
/* ------------------------------------------------------------------ */

let prevCpuTimes = os.cpus().map((c) => c.times);
let statsTimer = null;

/* 成长系统：音浪值 = 累计听歌秒数，等级用平方根曲线（约 10 分钟一级） */
function growth() {
  const wave = Math.max(0, Math.round(Number(store.get('listenTotal')) || 0));
  const level = 1 + Math.floor(Math.sqrt(wave / 600));
  const exp = wave % 600;
  if (Number(store.get('petLevel')) !== level) {
    store.set('petLevel', level);
    store.set('petExp', exp);
  }
  return { wave, level, exp, need: 600 };
}

const DAY_LIMIT = 50;

function recordHistory(pb) {
  if (!pb || !pb.title) return;
  const day = localDay();
  const map = store.get('listenHistory') || {};
  const list = Array.isArray(map[day]) ? map[day] : [];
  const last = list[list.length - 1];
  if (last && last.title === pb.title) return;
  list.push({ t: Date.now(), title: pb.title, artist: pb.artist || '' });
  while (list.length > DAY_LIMIT) list.shift();
  map[day] = list;
  const days = Object.keys(map).sort();
  while (days.length > 400) delete map[days.shift()];
  store.set('listenHistory', map);
}

function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function checkFlashback() {
  if (!petWin || petWin.isDestroyed()) return;
  const now = new Date();
  const lastYear = localDay(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()));
  const map = store.get('listenHistory') || {};
  const list = map[lastYear];
  if (!Array.isArray(list) || !list.length) return;
  const pick = list[Math.floor(Math.random() * list.length)];
  petWin.webContents.send('pet:flashback', { title: pick.title, artist: pick.artist || '' });
}

function sampleStats() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  cpus.forEach((c, i) => {
    const prev = prevCpuTimes[i] || c.times;
    idle += c.times.idle - prev.idle;
    total +=
      c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq -
      (prev.user + prev.nice + prev.sys + prev.idle + prev.irq);
  });
  prevCpuTimes = cpus.map((c) => c.times);
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  return {
    cpu: total > 0 ? Math.max(0, Math.min(1, 1 - idle / total)) : 0,
    mem: Math.max(0, Math.min(1, 1 - memFree / memTotal)),
    memUsedGB: (memTotal - memFree) / 1073741824,
    memTotalGB: memTotal / 1073741824,
    uptime: os.uptime(),
    listen: Number(store.get('listenTotal')) || 0,
    listenToday: Number(store.get('listenToday')) || 0,
    ...growth(),
  };
}

let lastStatsPush = 0;

function startWidgetStats() {
  clearInterval(statsTimer);
  statsTimer = setInterval(() => {
    if (!petWin || petWin.isDestroyed() || !petWin.webContents) return;
    const open = !!store.get('petPanelOpen');
    // 面板收起时只在播放中低频推送，保证音浪/升级仍然生效
    if (!open && !playback.playing) return;
    if (!open && Date.now() - lastStatsPush < 6000) return;
    lastStatsPush = Date.now();
    petWin.webContents.send('pet:stats', sampleStats());
  }, 2000);
}

/** 截图模式：用于无头/远程环境验证界面 */
async function captureShots() {
  const dir = path.join(dataDir(), 'shots');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    fs.mkdirSync(dir, { recursive: true });


    if (process.argv.includes('--login-shot')) {
      openLoginWindow().catch((e) => log('login win error', e && e.stack));
      await sleep(5500);
      log('login state', !!loginWin, loginWin && !loginWin.isDestroyed());
      if (loginWin && !loginWin.isDestroyed()) {
        const im = await loginWin.webContents.capturePage();
        fs.writeFileSync(path.join(dir, 'login.png'), im.toPNG());
        log('login shot', JSON.stringify(im.getSize()));
      }
      quitting = true;
      app.quit();
      return;
    }

    await sleep(1500);
    if (playerWin) {
      try {
        const hasRows = await playerWin.webContents.executeJavaScript(
          "!!document.querySelector('.row')"
        );
        if (hasRows) {
          await playerWin.webContents.executeJavaScript(
            "document.querySelector('.row').click()"
          );
          await sleep(6000);
          const title = await playerWin.webContents.executeJavaScript(
            "document.getElementById('pbTitle').textContent"
          );
          log('autoplay now playing:', title);
        }
      } catch (err) {
        log('autoplay error', err.message);
      }
      const img = await playerWin.webContents.capturePage();
      fs.writeFileSync(path.join(dir, 'player.png'), img.toPNG());
      log('shot player', JSON.stringify(img.getSize()));

      // 歌词面板
      try {
        await playerWin.webContents.executeJavaScript(
          "document.getElementById('btnLyrics').click()"
        );
        await sleep(2600);
        const lyImg = await playerWin.webContents.capturePage();
        fs.writeFileSync(path.join(dir, 'player-lyrics.png'), lyImg.toPNG());
        log('shot lyrics', JSON.stringify(lyImg.getSize()));
        await playerWin.webContents.executeJavaScript(
          "document.getElementById('btnLyrics').click()"
        );
        await sleep(300);
      } catch (err) {
        log('lyrics shot error', err.message);
      }

      // B站收藏页（未登录态）
      try {
        await playerWin.webContents.executeJavaScript(
          "document.querySelector('.tab[data-view=\"bfav\"]').click()"
        );
        await sleep(900);
        const favImg = await playerWin.webContents.capturePage();
        fs.writeFileSync(path.join(dir, 'player-fav.png'), favImg.toPNG());
        await playerWin.webContents.executeJavaScript(
          "document.querySelector('.tab[data-view=\"search\"]').click()"
        );
        await sleep(300);

        // 设置面板
        await playerWin.webContents.executeJavaScript(
          "document.getElementById('btnSettings').click()"
        );
        await sleep(450);
        fs.writeFileSync(
          path.join(dir, 'settings.png'),
          (await playerWin.webContents.capturePage()).toPNG()
        );
        await playerWin.webContents.executeJavaScript(
          "document.getElementById('btnCancelSettings').click()"
        );
        await sleep(250);

        // 右上角账号菜单
        await playerWin.webContents.executeJavaScript(
          "document.getElementById('btnAccount').click()"
        );
        await sleep(300);
        fs.writeFileSync(
          path.join(dir, 'account-menu.png'),
          (await playerWin.webContents.capturePage()).toPNG()
        );
        await playerWin.webContents.executeJavaScript(
          "document.body.click()"
        );
        await sleep(150);
      } catch (err) {
        log('fav shot error', err.message);
      }
    }
    if (petWin) {
      // 暂停播放 -> 桌宠回到 idle；再恢复播放 -> dance
      if (playerWin) {
        await playerWin.webContents
          .executeJavaScript("document.getElementById('btnPlay').click()")
          .catch(() => {});
      }
      await sleep(600);
      await petWin.webContents
        .executeJavaScript("say('♪ 正在播放：' + ((document.getElementById('nowTitle') || {}).textContent || '小鲸鱼的歌单'))")
        .catch(() => {});
      await sleep(250);
      fs.writeFileSync(
        path.join(dir, 'pet-idle.png'),
        (await petWin.webContents.capturePage()).toPNG()
      );

      // 组件面板（时钟 / 系统 / 番茄钟）
      petWin.webContents.send('pet:panel', true);
      petWin.webContents.send('pet:stats', sampleStats());
      await sleep(600);
      fs.writeFileSync(
        path.join(dir, 'pet-panel.png'),
        (await petWin.webContents.capturePage()).toPNG()
      );
      petWin.webContents.send('pet:panel', false);
      await sleep(200);

      if (playerWin) {
        await playerWin.webContents
          .executeJavaScript("document.getElementById('btnPlay').click()")
          .catch(() => {});
      }
      await sleep(700);
      await petWin.webContents
        .executeJavaScript("say('♪ 一起摇起来')")
        .catch(() => {});
      await sleep(250);
      fs.writeFileSync(
        path.join(dir, 'pet-dance.png'),
        (await petWin.webContents.capturePage()).toPNG()
      );

      // 摸头
      await petWin.webContents.executeJavaScript("pat()").catch(() => {});
      await sleep(420);
      fs.writeFileSync(
        path.join(dir, 'pet-pat.png'),
        (await petWin.webContents.capturePage()).toPNG()
      );
      log('pet shots done');
    }

  } catch (err) {
    log('shot error', err && err.stack);
  }
  quitting = true;
  app.quit();
}

app.on('window-all-closed', () => {
  // 托盘常驻，不退出
});

app.on('before-quit', () => {
  quitting = true;
  globalShortcut.unregisterAll();
  if (store) store.flush();
});

/* ------------------------------------------------------------------ */
/* 窗口                                                                */
/* ------------------------------------------------------------------ */

/** 主屏可用区域，换算成窗口坐标（DIP）；高分屏下 Electron 给的 workArea 可能是物理像素 */
function workAreaDip() {
  // Electron 的 workArea / getBounds / setBounds 都是 DIP，直接用
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
}

function createPlayer() {
  const area = workAreaDip();
  // 记住上次的窗口大小/位置；首次启动给一个更宽的默认值
  const saved = store.get('winBounds');
  let width = 640;
  let height = Math.min(900, area.height - 50);
  let x = Math.round(area.x + (area.width - width) / 2);
  let y = Math.round(area.y + (area.height - height) / 2);
  if (saved && saved.width >= 480 && saved.height >= 600) {
    width = Math.min(saved.width, area.width - 20);
    height = Math.min(saved.height, area.height - 20);
    x = Math.min(Math.max(area.x, saved.x), area.x + area.width - width);
    y = Math.min(Math.max(area.y, saved.y), area.y + area.height - height);
  }
  playerWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 520,
    minHeight: 640,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    title: '鲸音 BiuWhale',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-player.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  let saveBoundsTimer = null;
  const persistBounds = () => {
    clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      try {
        if (!playerWin || playerWin.isDestroyed() || playerWin.isMinimized()) return;
        const b = playerWin.getBounds();
        if (b.width >= 480 && b.height >= 600) store.set('winBounds', b);
      } catch (_) {}
    }, 500);
  };
  playerWin.on('resize', persistBounds);
  playerWin.on('move', persistBounds);

  playerWin.loadFile(path.join(__dirname, 'renderer', 'player', 'index.html'));

  playerWin.webContents.on('console-message', (_e, level, message) => {
    log('player console:', level, message);
  });
  playerWin.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log('player fail-load:', code, desc, url);
  });

  playerWin.once('ready-to-show', () => {
    log('displays', JSON.stringify(screen.getAllDisplays().map((d) => ({ b: d.bounds, w: d.workArea, s: d.scaleFactor }))));
    log('player bounds before center', JSON.stringify(playerWin.getBounds()));
    const pb = playerWin.getBounds();
    const wa = workAreaDip();
    // 自己算居中：高分屏下 Electron 的 center() 会按错误的屏幕尺寸偏移
    const px = Math.max(wa.x, Math.round(wa.x + (wa.width - pb.width) / 2));
    const py = Math.max(wa.y, Math.round(wa.y + (wa.height - pb.height) / 2));
    playerWin.setBounds({ x: px, y: py, width: pb.width, height: pb.height });
    log('player bounds after center', JSON.stringify(playerWin.getBounds()));
    playerWin.show();
    playerWin.focus();
  });

  playerWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      playerWin.hide();
    }
  });

  playerWin.on('closed', () => {
    playerWin = null;
  });
}

function createPet() {
  const scale = Number(store.get('petScale')) || 1;
  pet.scale = scale;
  const w = Math.round((PET_W + PET_PANEL_W) * scale);
  const h = Math.round(PET_H * scale);
  const area = workAreaDip();

  // 默认停在右下角（和 DSH 里的挂件一致），之后记住拖动后的位置
  const saved = store.get('petPos');
  const margin = 24;
  // 分辨率/缩放变化后旧的坐标可能已经跑到屏外，创建时就夹一次
  const minX = area.x + Math.round(PET_W * scale) - w;
  const maxX = area.x + area.width - w;
  const maxY = area.y + area.height - h;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  pet.x = saved && Number.isFinite(saved.x)
    ? clamp(saved.x, minX, maxX)
    : area.x + area.width - w - margin;
  pet.y = saved && Number.isFinite(saved.y)
    ? clamp(saved.y, area.y, maxY)
    : area.y + area.height - h - margin;

  petWin = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(pet.x),
    y: Math.round(pet.y),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: store.get('petAlwaysOnTop') !== false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-pet.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  petWin.setAlwaysOnTop(store.get('petAlwaysOnTop') !== false, 'floating');
  petWin.loadFile(path.join(__dirname, 'renderer', 'pet', 'index.html'), {
    query: { scale: String(scale) },
  });
  petWin.setIgnoreMouseEvents(true, { forward: true });

  // Windows 下 ignoreMouseEvents(true) 时 Chromium 收不到 mousemove，
  // 由主进程轮询光标位置来判断「是否在鲸鱼/面板上」，再决定是否可交互。
  if (petWin.__hoverTimer) clearInterval(petWin.__hoverTimer);
  petWin.__hoverTimer = setInterval(() => {
    if (!petWin || petWin.isDestroyed()) return;
    if (pet.dragging) {
      if (pet.__interactive !== true) {
        pet.__interactive = true;
        petWin.setIgnoreMouseEvents(false);
      }
      return;
    }
    const c = screen.getCursorScreenPoint();
    const cx = c.x;
    const cy = c.y;
    const b = petWin.getBounds();
    const whaleW = Math.round(PET_W * (pet.scale || 1));
    const panelOpen = store.get('petPanelOpen') === true;
    const inWhale = cx >= b.x + b.width - whaleW && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height;
    const inPanel = panelOpen && cx >= b.x && cx <= b.x + b.width - whaleW && cy >= b.y && cy <= b.y + b.height;
    const btnR = 18;
    const btnX = b.x + 8 + 13;
    const btnY = b.y + b.height - 12 - 13;
    const inBtn = Math.abs(cx - btnX) <= btnR && Math.abs(cy - btnY) <= btnR;
    const inside = inWhale || inPanel || inBtn;
    if (inside !== pet.__interactive) {
      pet.__interactive = inside;
      if (process.env.NEKO_TRACE_DRAG) log('hover ->', inside, JSON.stringify({ cx, cy, b: { x: b.x, y: b.y, w: b.width, h: b.height } }));
      petWin.setIgnoreMouseEvents(!inside, { forward: true });
    }
  }, 80);


  petWin.once('ready-to-show', () => {
    if (store.get('showPet') !== false) petWin.showInactive();
    petWin.webContents.send('pet:scale', scale);
    petWin.webContents.send('pet:panel', store.get('petPanelOpen') === true);
    clampPetBounds();
    savePetPosition();
    log(
      'pet shown: visible=',
      petWin.isVisible(),
      'top=',
      petWin.isAlwaysOnTop(),
      'bounds=',
      JSON.stringify(petWin.getBounds())
    );
  });

  petWin.on('closed', () => {
    if (petWin && petWin.__hoverTimer) clearInterval(petWin.__hoverTimer);
    petWin = null;
  });
}

function showPlayer() {
  if (!playerWin) return;
  if (playerWin.isMinimized()) playerWin.restore();
  if (!playerWin.isVisible()) playerWin.show();
  playerWin.focus();
}

function createTray() {
  const iconPath = path.join(ASSETS, 'tray.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) image = nativeImage.createEmpty();
  tray = new Tray(image.resize({ width: 20, height: 20 }));
  tray.setToolTip('鲸音 BiuWhale · 小鲸鱼音乐播放器');

  const rebuild = () => {
    const menu = Menu.buildFromTemplate([
      { label: '打开播放器', click: () => showPlayer() },
      { type: 'separator' },
      {
        label: playback.playing ? '暂停' : '播放',
        click: () => sendCommand('toggle'),
      },
      { label: '上一首', click: () => sendCommand('prev') },
      { label: '下一首', click: () => sendCommand('next') },
      { type: 'separator' },
      {
        label: '显示小鲸鱼',
        type: 'checkbox',
        checked: store.get('showPet') !== false,
        click: (item) => {
          store.set('showPet', item.checked);
          if (!petWin) return;
          if (item.checked) petWin.showInactive();
          else petWin.hide();
        },
      },
      { label: '桌宠置顶', type: 'checkbox', checked: store.get('petAlwaysOnTop') !== false, click: (item) => {
          store.set('petAlwaysOnTop', item.checked);
          if (petWin) petWin.setAlwaysOnTop(item.checked, 'floating');
        } },
      { type: 'separator' },
      { label: '退出 鲸音 BiuWhale', click: () => { quitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(menu);
  };

  rebuild();
  tray.on('double-click', () => showPlayer());
  log('tray created:', !!tray);

  // 只在播放状态变化时重建菜单，避免 timeupdate 频繁刷新
  let lastPlaying = null;
  app.on('nekobiu:playback-changed', () => {
    if (lastPlaying === playback.playing) return;
    lastPlaying = playback.playing;
    rebuild();
  });
}

function registerShortcuts() {
  const map = {
    MediaPlayPause: 'toggle',
    MediaNextTrack: 'next',
    MediaPreviousTrack: 'prev',
  };
  for (const [accel, cmd] of Object.entries(map)) {
    try {
      globalShortcut.register(accel, () => sendCommand(cmd));
    } catch (_) {
      /* 被其他播放器占用时忽略 */
    }
  }
}

function sendCommand(cmd) {
  if (!playerWin) return;
  if (!playerWin.isVisible() && cmd !== 'toggle') showPlayer();
  playerWin.webContents.send('command', cmd);
}

/* ------------------------------------------------------------------ */
/* 桌宠：固定站位，只支持拖动                                            */
/* ------------------------------------------------------------------ */

function petSize() {
  return {
    w: Math.round((PET_W + PET_PANEL_W) * pet.scale),
    h: Math.round(PET_H * pet.scale),
  };
}

function clampPetBounds() {
  if (!petWin || petWin.isDestroyed()) return;
  const b = petWin.getBounds();
  const wa = workAreaDip();
  const size = petSize();
  const whaleW = Math.round(PET_W * pet.scale);
  // 鲸鱼本体必须完整可见；组件面板允许移出屏幕
  const minX = wa.x + whaleW - b.width;
  const maxX = wa.x + wa.width - b.width;
  const x = Math.min(Math.max(b.x, minX), Math.max(minX, maxX));
  const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - b.height);
  if (x !== b.x || y !== b.y || b.width !== size.w || b.height !== size.h) {
    pet.x = x;
    pet.y = y;
    petWin.setBounds({ x, y, width: size.w, height: size.h });
  }
}

function savePetPosition() {
  if (!petWin || petWin.isDestroyed()) return;
  const [x, y] = petWin.getPosition();
  pet.x = x;
  pet.y = y;
  store.set('petPos', { x, y });
}

function applyPetScale(scale) {
  const next = Math.max(0.7, Math.min(1.6, Number(scale) || 1));
  if (!petWin || petWin.isDestroyed()) {
    pet.scale = next;
    store.set('petScale', next);
    return;
  }
  const old = petWin.getBounds();
  pet.scale = next;
  store.set('petScale', next);
  const { w, h } = petSize();
  // 以右下角为锚点缩放，视觉上不跳动
  const x = Math.round(old.x + old.width - w);
  const y = Math.round(old.y + old.height - h);
  pet.x = x;
  pet.y = y;
  petWin.setBounds({ x, y, width: w, height: h });
  clampPetBounds();
  savePetPosition();
  petWin.webContents.send('pet:scale', pet.scale);
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

/* 弹幕氛围：主进程抓取 danmaku，桌宠只负责说 */
const danmakuCache = new Map();

function decodeDmXml(xml) {
  const out = [];
  const re = /<d p="[^"]*">([\s\S]*?)<\/d>/g;
  let m;
  while ((m = re.exec(xml))) {
    const text = m[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    if (text && text.length <= 60 && !out.includes(text)) out.push(text);
    if (out.length >= 200) break;
  }
  return out;
}

ipcMain.handle('pet:danmaku', async (_e, bvid, cid) => {
  const key = String(cid || bvid || '');
  if (!key) return { ok: false };
  if (danmakuCache.has(key)) return { ok: true, list: danmakuCache.get(key) };
  try {
    const url = `https://api.bilibili.com/x/v1/dm/list.so?oid=${encodeURIComponent(cid || bvid)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://www.bilibili.com/',
      },
    });
    if (!res.ok) return { ok: false };
    const buf = Buffer.from(await res.arrayBuffer());
    const xml = buf.toString('utf8');
    const list = decodeDmXml(xml);
    danmakuCache.set(key, list);
    log('danmaku fetched', key, list.length);
    return { ok: true, list };
  } catch (err) {
    log('danmaku error', err && err.message);
    return { ok: false };
  }
});

let lastLyricLine = '';

ipcMain.on('lyric:line', (_e, text) => {
  const line = String(text || '').slice(0, 120);
  if (line === lastLyricLine) return;
  lastLyricLine = line;
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('lyric:line', line);
});

ipcMain.handle('lyrics:get', async (_e, q) => {
  try {
    return await lyricClient.get(q || {});
  } catch (e) {
    log('lyrics error', e && e.message);
    return { ok: false };
  }
});

ipcMain.handle('bili:search', async (_e, keyword, page) => {
  try {
    const res = await bili.search(String(keyword || '').trim(), Number(page) || 1);
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: err.message || '搜索失败', code: err.code };
  }
});

ipcMain.handle('bili:resolve', async (_e, bvid) => {
  try {
    return { ok: true, data: await bili.resolve(bvid) };
  } catch (err) {
    return { ok: false, error: err.message || '解析失败', code: err.code };
  }
});

ipcMain.handle('bili:audio', async (_e, bvid, cid) => {
  try {
    return { ok: true, data: await bili.audioUrl(bvid, cid) };
  } catch (err) {
    return { ok: false, error: err.message || '获取音频流失败', code: err.code };
  }
});

/* ------------------------------------------------------------------ */
/* B 站登录 / 收藏                                                      */
/* ------------------------------------------------------------------ */

const BILI_COOKIE_NAMES = [
  'SESSDATA',
  'bili_jct',
  'DedeUserID',
  'DedeUserID__ckMd5',
  'sid',
  'buvid3',
  'buvid4',
];

let loginWin = null;

async function collectBiliCookies() {
  const ses = session.defaultSession;
  const out = [];
  for (const name of BILI_COOKIE_NAMES) {
    const list = await ses.cookies.get({ name });
    const hit = list.find((c) => /bilibili\.com$/.test(c.domain));
    if (hit && hit.value) out.push(`${hit.name}=${hit.value}`);
  }
  return out.join('; ');
}

async function currentUser() {
  if (!store.get('cookie')) return { isLogin: false };
  try {
    const info = await bili.navInfo();
    if (!info.isLogin) return { isLogin: false, needLogin: true };
    store.set('mid', info.mid);
    store.set('user', { uname: info.uname, face: info.face });
    // 服务端可能下发新的 buvid3/SESSDATA，及时回写，避免下次启动被判未登录
    store.set('cookie', bili.getCookie());
    return { isLogin: true, ...info };
  } catch (err) {
    log('nav failed', err.message);
    // 网络异常不等于登录失效：有本地账号就按"离线已登录"继续用
    const u = store.get('user');
    if (u && u.uname) {
      return {
        isLogin: true,
        offline: true,
        mid: store.get('mid'),
        uname: u.uname,
        face: u.face || '',
      };
    }
    return { isLogin: false, offline: true };
  }
}

function openLoginWindow() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve(payload);
    };

    loginWin = new BrowserWindow({
      width: 820,
      height: 900,
      minWidth: 480,
      minHeight: 620,
      resizable: true,
      parent: playerWin && !playerWin.isDestroyed() ? playerWin : undefined,
      modal: false,
      show: true,
      autoHideMenuBar: true,
      title: '登录 B 站',
      backgroundColor: '#ffffff',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // 二维码会过期，页面里塞一个「刷新二维码」按钮，Ctrl+R / F5 也能重载
    const injectRefreshBtn = () => {
      if (!loginWin || loginWin.isDestroyed()) return;
      loginWin.webContents
        .executeJavaScript(`(() => {
          if (document.getElementById('__bw_refresh')) return;
          const b = document.createElement('button');
          b.id = '__bw_refresh';
          b.textContent = '刷新二维码';
          b.title = '二维码过期了点这里（Ctrl+R）';
          b.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:9px 16px;' +
            'border-radius:999px;border:1px solid #00aeec;background:#fff;color:#00aeec;font-size:13px;' +
            'font-weight:600;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.18)';
          b.onclick = () => location.reload();
          document.body.appendChild(b);
        })()`)
        .catch(() => {});
    };
    loginWin.webContents.on('did-finish-load', injectRefreshBtn);
    loginWin.webContents.on('before-input-event', (_e, input) => {
      const k = (input.key || '').toLowerCase();
      if (input.type === 'keyDown' && (k === 'f5' || (input.control && k === 'r'))) {
        loginWin.webContents.reload();
      }
    });
    loginWin.loadURL('https://passport.bilibili.com/login');
    log('login window created', JSON.stringify(loginWin.getBounds()));

    // B 站登录页按桌面宽度设计：窗口窄时缩小、拉大后逐步恢复，保证二维码始终完整
    let fitTimer = null;
    const fitLoginZoom = async () => {
      if (!loginWin || loginWin.isDestroyed()) return;
      try {
        const dims = await loginWin.webContents.executeJavaScript(
          '({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })'
        );
        if (!dims.cw || !dims.sw) return;
        const cur = loginWin.webContents.getZoomFactor();
        const next = Math.max(0.4, Math.min(1, cur * (dims.cw / dims.sw) * 0.985));
        if (Math.abs(next - cur) > 0.02) loginWin.webContents.setZoomFactor(next);
      } catch (_) {}
    };
    loginWin.webContents.on('did-finish-load', () => setTimeout(fitLoginZoom, 350));
    loginWin.on('resize', () => {
      clearTimeout(fitTimer);
      fitTimer = setTimeout(fitLoginZoom, 260);
    });

    const timer = setInterval(async () => {
      try {
        const cookie = await collectBiliCookies();
        if (!/(^|;\s*)SESSDATA=/.test(cookie)) return;
        bili.setCookie(cookie);
        const info = await bili.navInfo();
        if (!info.isLogin) return;
        store.set('cookie', cookie);
        store.set('mid', info.mid);
        store.set('user', { uname: info.uname, face: info.face });
        if (loginWin && !loginWin.isDestroyed()) loginWin.close();
        loginWin = null;
        finish({ ok: true, user: info });
      } catch (err) {
        log('login poll error', err.message);
      }
    }, 700);

    loginWin.on('closed', () => {
      log('login window closed');
      loginWin = null;
      clearInterval(timer);
      finish({ ok: false, cancelled: true });
    });
  });
}

ipcMain.handle('auth:state', async () => currentUser());

ipcMain.handle('auth:login', async () => {
  if (store.get('cookie')) {
    const u = await currentUser();
    if (u.isLogin) return { ok: true, user: u };
  }
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus();
    return { ok: false, pending: true };
  }
  return openLoginWindow();
});

ipcMain.handle('auth:logout', async () => {
  store.set('cookie', '');
  store.set('user', null);
  store.set('mid', 0);
  bili.setCookie('');
  try {
    const ses = session.defaultSession;
    for (const name of BILI_COOKIE_NAMES) {
      const list = await ses.cookies.get({ name });
      for (const c of list) {
        if (!/bilibili\.com$/.test(c.domain)) continue;
        const url = `https://${c.domain.replace(/^\./, '')}${c.path || '/'}`;
        await ses.cookies.remove(url, c.name).catch(() => {});
      }
    }
  } catch (err) {
    log('logout clean failed', err.message);
  }
  return { ok: true };
});

ipcMain.handle('bili:fav-folders', async () => {
  try {
    const mid = store.get('mid');
    if (!mid) return { ok: false, error: '请先登录 B 站', needLogin: true };
    const folders = await bili.favFolders(mid);
    return { ok: true, data: folders };
  } catch (err) {
    if (err && err.code === -101) {
      return { ok: false, needLogin: true, error: '登录已过期，重新扫码登录一下吧' };
    }
    return { ok: false, error: err.message || '获取收藏夹失败' };
  }
});

ipcMain.handle('bili:fav-list', async (_e, mediaId, pn) => {
  try {
    const res = await bili.favList(mediaId, Number(pn) || 1, 20);
    return { ok: true, data: res };
  } catch (err) {
    if (err && err.code === -101) {
      return { ok: false, needLogin: true, error: '登录已过期，重新扫码登录一下吧' };
    }
    return { ok: false, error: err.message || '获取收藏内容失败' };
  }
});

ipcMain.handle('bili:open-external', async (_e, url) => {
  if (/^https:\/\/(www\.bilibili\.com|space\.bilibili\.com)\//.test(url)) {
    shell.openExternal(url);
  }
});

ipcMain.handle('store:all', () => store.all);

ipcMain.handle('store:set', (_e, key, value) => {
  store.set(key, value);
  if (key === 'cookie') bili.setCookie(value);
  return true;
});

ipcMain.handle('settings:apply', (_e, patch) => {
  if (!patch) return true;
  if (typeof patch.petScale === 'number') applyPetScale(patch.petScale);
  if (typeof patch.petAlwaysOnTop === 'boolean') {
    store.set('petAlwaysOnTop', patch.petAlwaysOnTop);
    if (petWin) petWin.setAlwaysOnTop(patch.petAlwaysOnTop, 'floating');
  }
  if (typeof patch.showPet === 'boolean') {
    store.set('showPet', patch.showPet);
    if (petWin) patch.showPet ? petWin.showInactive() : petWin.hide();
  }
  return { ok: true };
});


ipcMain.on('playback:update', (_e, state) => {
  Object.assign(playback, state || {});
  if (tray) tray.setToolTip(
    playback.title ? `鲸音 BiuWhale · ${playback.title}` : '鲸音 BiuWhale · 小鲸鱼音乐播放器'
  );
  if (petWin && !petWin.isDestroyed()) {
    petWin.webContents.send('playback', {
      playing: playback.playing,
      title: playback.title,
      artist: playback.artist,
      hasGroup: !!playback.hasGroup,
      duration: playback.duration || 0,
      author: playback.author || '',
      bvid: playback.bvid || '',
      cid: playback.cid || '',
      page: playback.page || 0,
    });
  }
  recordHistory(playback);
  app.emit('nekobiu:playback-changed');
});

ipcMain.on('player:hide', () => playerWin && playerWin.hide());
ipcMain.on('player:minimize', () => playerWin && playerWin.minimize());

ipcMain.on('pet:panel', (_e, open) => {
  store.set('petPanelOpen', open === true);
  if (open && petWin && !petWin.isDestroyed()) {
    petWin.webContents.send('pet:stats', sampleStats());
  }
});

ipcMain.on('pet:interactive', (_e, interactive) => {
  if (!petWin || petWin.isDestroyed()) return;
  if (pet.dragging && !interactive) return; // 拖动期间保持可接收事件
  petWin.setIgnoreMouseEvents(!interactive, { forward: true });
  if (process.env.NEKO_TRACE_MOUSE) log('interactive ->', interactive);
});

ipcMain.on('pet:over', () => {});

ipcMain.on('pet:drag-start', (_e, point) => {
  if (!petWin || petWin.isDestroyed()) return;
  pet.dragging = true;
  petWin.webContents.send('pet:action', 'drag');
  petWin.setIgnoreMouseEvents(false);
  const [wx, wy] = petWin.getPosition();
  pet.dragOffset = { x: point.x - wx, y: point.y - wy };
  clearInterval(pet.dragTimer);
  pet.dragTimer = setInterval(() => {
    if (!pet.dragging || !petWin || petWin.isDestroyed()) return;
    const c = screen.getCursorScreenPoint();
    pet.x = c.x - pet.dragOffset.x;
    pet.y = c.y - pet.dragOffset.y;
    const wa = workAreaDip();
    const size = petSize();
    const minX = wa.x + Math.round(PET_W * (pet.scale || 1)) - size.w;
    const maxX = wa.x + wa.width - size.w;
    const nx = Math.min(Math.max(pet.x, Math.min(minX, maxX)), maxX);
    const ny = Math.min(Math.max(pet.y, wa.y), wa.y + wa.height - size.h);
    pet.x = nx;
    pet.y = ny;
    if (process.env.NEKO_TRACE_DRAG && ++pet.traceTick % 8 === 0) {
      log('drag', JSON.stringify({ c: { x: c.x, y: c.y }, s, off: pet.dragOffset, nx, ny, wa }));
    }
    petWin.setBounds({ x: Math.round(nx), y: Math.round(ny), width: size.w, height: size.h });
  }, 16);
});

ipcMain.on('pet:drag-end', () => {
  pet.dragging = false;
  clearInterval(pet.dragTimer);
  pet.dragTimer = null;
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('pet:action', 'idle');
  clampPetBounds();
  savePetPosition();
});

ipcMain.on('pet:open-player', () => showPlayer());

ipcMain.on('pet:command', (_e, cmd) => {
  if (['toggle', 'next', 'prev', 'next-group'].includes(cmd)) sendCommand(cmd);
});

ipcMain.on('pet:context-menu', () => {
  if (!petWin) return;
  const { w } = petSize();
  const menu = Menu.buildFromTemplate([
    { label: playback.playing ? '暂停' : '播放', click: () => sendCommand('toggle') },
    { label: '上一首', click: () => sendCommand('prev') },
    { label: '下一首', click: () => sendCommand('next') },
    { type: 'separator' },
    { label: '打开播放器', click: () => showPlayer() },
    {
      label: '桌宠大小',
      submenu: [0.8, 1, 1.25, 1.5].map((s) => ({
        label: `${Math.round(s * 100)}%`,
        type: 'radio',
        checked: Math.abs(pet.scale - s) < 0.01,
        click: () => {
          applyPetScale(s);
          if (playerWin) playerWin.webContents.send('settings:changed', { petScale: s });
        },
      })),
    },
    {
      label: '隐藏小鲸鱼',
      click: () => {
        store.set('showPet', false);
        petWin.hide();
      },
    },
    { type: 'separator' },
    { label: '退出 鲸音 BiuWhale', click: () => { quitting = true; app.quit(); } },
  ]);
  menu.popup({ window: petWin, x: Math.round(w / 2), y: 20 });
});
