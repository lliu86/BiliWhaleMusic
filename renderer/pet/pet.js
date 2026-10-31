'use strict';

/* BiliWhaleMusic 桌宠 —— DeepSeek 小鲸鱼
   形象与气泡风格来自 dsh-whale-widget（MIT，Copyright (c) 2026 MeteorNOX）。
   桌面版行为：固定在原地漂浮，不自己走动；可以拖动；播放音乐时摇摆。 */

const stage = document.getElementById('stage');
const whale = document.getElementById('whale');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubbleText');
const petpet = document.getElementById('petpet');

const params = new URLSearchParams(location.search);
let scale = Number(params.get('scale')) || 1;
document.documentElement.style.setProperty('--s', String(scale));

let bubbleTimer = null;
let lastTitle = '';
let lastArtist = '';
let playing = false;

function setAction(a) {
  for (const name of ['idle', 'dance', 'drag']) {
    document.body.classList.toggle('action-' + name, a === name);
  }
}

/* 情绪：只影响 dance 动画强度，不改动作状态机 */
let mood = 'chill';
function setMood(next) {
  if (!next || next === mood) return;
  mood = next;
  for (const m of ['chill', 'hype', 'happy']) {
    document.body.classList.toggle('mood-' + m, m === next);
  }
}

function pickMood(state) {
  if (state.hasGroup === false) return 'happy';
  const t = String(state.title || '') + ' ' + String(state.artist || '');
  // 抒情/治愈类关键词优先：5 分钟以上的抒情曲不应被时长规则误判成 hype
  if (/抒情|温柔|安静|治愈|钢琴|纯音乐|钢琴曲|民谣|轻音乐|睡前/i.test(t)) return 'chill';
  if (/remix|燃|战歌|电音|dance|蹦迪|DJ|摇滚|串烧|EDM|加速/i.test(t)) return 'hype';
  if (Number(state.duration) >= 300) return 'hype';
  return 'chill';
}

let lyricTimer = null;
let lyricHold = null;

function stopLyric() {
  clearInterval(lyricTimer);
  clearTimeout(lyricHold);
  lyricTimer = null;
  lyricHold = null;
}

function say(text, ms = 4200) {
  stopLyric();
  bubbleText.textContent = text;
  bubble.classList.add('show');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
}

/* 逐字歌词：像在哼唱 */
function sayLyric(text) {
  if (!text) {
    if (lastTitle) say('♪ ' + lastTitle, 4200);
    return;
  }
  stopLyric();
  clearTimeout(bubbleTimer);
  bubbleText.textContent = '';
  bubble.classList.add('show');
  let i = 0;
  lyricTimer = setInterval(() => {
    i += 1;
    bubbleText.textContent = text.slice(0, i);
    if (i >= text.length) {
      clearInterval(lyricTimer);
      lyricTimer = null;
    }
  }, 85);
}

/* ---------------- 与主进程联动 ---------------- */

window.petAPI.onAction((a) => {
  // 拖动结束后回到当前播放状态对应的动作
  if (a === 'idle') setAction(playing ? 'dance' : 'idle');
  else setAction(a);
});

const pNextGroup = document.getElementById('pNextGroup');

function fmtListen(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm';
  return s + 's';
}

window.petAPI.onPlayback((state) => {
  const changed = state.title && state.title !== lastTitle;
  if (state.title) lastTitle = state.title;
  if (state.artist) lastArtist = state.artist;
  playing = !!state.playing;
  setMood(pickMood(state));

  if (playing) setAction('dance');
  else setAction('idle');

  updatePlayIcon();
  if (nowTitle) nowTitle.textContent = state.title || '未在播放';
  if (pNextGroup) pNextGroup.style.display = state.hasGroup ? '' : 'none';
  if (changed) {
    say('♪ ' + state.title);
    requestDanmaku(state);
  }
});

/* 实时节拍：强度驱动摇摆速度(--dance-dur)与摆幅(--sway)，实现随音乐律动 */
window.petAPI.onBeat((v) => {
  if (!v) return;
  const level = Math.max(0, Math.min(1, Number(v.level) || 0));
  // 强度 0 → 1.2s/2deg（舒缓），强度 1 → 0.3s/8deg（劲爆）
  const dur = (1.2 - level * 0.9).toFixed(2) + 's';
  const sway = (2 + level * 6).toFixed(1) + 'deg';
  document.body.style.setProperty('--dance-dur', dur);
  document.body.style.setProperty('--sway', sway);
});

/* 弹幕氛围：切歌时挑一条真实弹幕吐槽 */
let lastDanmakuKey = '';
function requestDanmaku(state) {
  if (!window.petAPI.danmaku) return;
  const key = String(state.cid || state.bvid || '');
  if (!key || key === lastDanmakuKey) return;
  lastDanmakuKey = key;
  if (!state.bvid && !state.cid) return;
  window.petAPI
    .danmaku(state.bvid, state.cid)
    .then((res) => {
      if (!res || !res.ok || !res.list || !res.list.length) return;
      const pool = res.list.filter((t) => t.length >= 5 && t.length <= 30);
      const list = pool.length ? pool : res.list;
      const text = list[Math.floor(Math.random() * list.length)];
      // 延迟 1.2s 再显示，让「♪ 曲名」气泡先停留一会儿；若期间已切歌则丢弃
      setTimeout(() => {
        if (key === lastDanmakuKey) say('弹幕说：' + text, 4500);
      }, 1200);
    })
    .catch(() => {});
}

window.petAPI.onScale((s) => {
  scale = s;
  document.documentElement.style.setProperty('--s', String(s));
});

window.petAPI.onStats((st) => renderStats(st));

/* ---------------- 面板里的播放控制 ---------------- */

const hearts = document.getElementById('hearts');
const icoPlay = document.getElementById('pIcoPlay');
const icoPause = document.getElementById('pIcoPause');
const nowTitle = document.getElementById('nowTitle');

function updatePlayIcon() {
  if (!icoPlay || !icoPause) return;
  icoPlay.style.display = playing ? 'none' : 'block';
  icoPause.style.display = playing ? 'block' : 'none';
}

function bindControl(id, cmd) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.petAPI.command(cmd);
    if (cmd === 'toggle') {
      playing = !playing;
      updatePlayIcon();
    }
  });
}
bindControl('pPrev', 'prev');
bindControl('pPlay', 'toggle');
bindControl('pNext', 'next');
bindControl('pNextGroup', 'next-group');

/* ---------------- 组件面板（时钟 / 系统 / 番茄钟） ---------------- */

const panel = document.getElementById('panel');
const widgetBtn = document.getElementById('widgetBtn');

function setPanel(open) {
  panel.classList.toggle('hide', !open);
  widgetBtn.title = open ? '收起组件' : '组件';
}

widgetBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
widgetBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = panel.classList.contains('hide');
  setPanel(open);
  window.petAPI.panel(open);
  hideControls();
});

window.petAPI.onPanel((open) => setPanel(!!open));

// 单击鲸鱼 = 展开/收起面板（控制条搬进面板后不再单独弹出）
function showControls() {
  if (panel.classList.contains('hide')) {
    setPanel(true);
    window.petAPI.panel(true);
  }
}
function hideControls() {}

/* 时钟 */
const clockTime = document.getElementById('clockTime');
const clockDate = document.getElementById('clockDate');
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function tickClock() {
  const d = new Date();
  clockTime.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  clockDate.textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${WEEK[d.getDay()]}`;
}
tickClock();
setInterval(tickClock, 1000);

/* 系统状态 */
const cpuVal = document.getElementById('cpuVal');
const memVal = document.getElementById('memVal');
const cpuBar = document.getElementById('cpuBar');
const memBar = document.getElementById('memBar');
function renderStats(st) {
  if (!st) return;
  const cpu = Math.round((st.cpu || 0) * 100);
  const mem = Math.round((st.mem || 0) * 100);
  cpuVal.textContent = cpu + '%';
  memVal.textContent = `${st.memUsedGB.toFixed(1)} / ${st.memTotalGB.toFixed(0)}G`;
  cpuBar.style.width = cpu + '%';
  memBar.style.width = mem + '%';
  const listenEl = document.getElementById('listenVal');
  if (listenEl) listenEl.textContent = fmtListen(st.listen);
  renderGrow(st);
  cpuBar.classList.toggle('hot', cpu >= 80);
  memBar.classList.toggle('hot', mem >= 88);
}

/* 番茄钟 */
const timerVal = document.getElementById('timerVal');
const timerToggle = document.getElementById('timerToggle');
const timerReset = document.getElementById('timerReset');
const FOCUS_SEC = 25 * 60;
let remain = FOCUS_SEC;
let running = false;
let ticker = null;

function renderTimer() {
  const m = Math.floor(remain / 60);
  const sec = remain % 60;
  timerVal.textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  timerToggle.textContent = running ? '暂停' : '开始';
  document.title = running ? `${timerVal.textContent} · 专注中` : 'BiliWhaleMusic Pet';
}
function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}
timerToggle.addEventListener('click', () => {
  running = !running;
  stopTicker();
  if (running) {
    ticker = setInterval(() => {
      remain -= 1;
      if (remain <= 0) {
        remain = 0;
        running = false;
        stopTicker();
        say('时间到，休息一下～', 5000);
      }
      renderTimer();
    }, 1000);
  }
  renderTimer();
});
timerReset.addEventListener('click', () => {
  running = false;
  stopTicker();
  remain = FOCUS_SEC;
  renderTimer();
});
renderTimer();

/* ---------------- 成长系统（音浪值） ---------------- */

let lastLevel = 0;

function renderGrow(st) {
  const level = Number(st.level) || 1;
  const exp = Number(st.exp) || 0;
  const need = Number(st.need) || 600;
  const wave = Number(st.wave) || 0;
  const lvEl = document.getElementById('growLevel');
  const waveEl = document.getElementById('growWave');
  const barEl = document.getElementById('growBar');
  const expEl = document.getElementById('growExp');
  if (lvEl) lvEl.textContent = 'Lv.' + level;
  if (waveEl) waveEl.textContent = wave.toLocaleString('zh-CN') + ' 音浪';
  if (barEl) barEl.style.width = Math.min(100, Math.round((exp / need) * 100)) + '%';
  if (expEl) {
    const left = Math.max(0, Math.ceil((need - exp) / 60));
    expEl.textContent = exp + ' / ' + need + ' · 再听 ' + left + ' 分钟升级';
  }
  if (lastLevel && level > lastLevel) {
    say('升到 Lv.' + level + ' 啦，继续喂我歌～', 4500);
  }
  lastLevel = level;
  document.body.classList.toggle('lv3', level >= 3);
}

/* ---------------- 时光机 ---------------- */

window.petAPI.onFlashback((data) => {
  if (!data || !data.title) return;
  say('📅 去年今日你在听《' + data.title + '》', 6000);
});

/* ---------------- 歌词哼唱 ---------------- */

window.petAPI.onLyricLine((text) => {
  if (!playing) return;
  sayLyric(text);
});

/* ---------------- 摸头 ---------------- */

let patCount = 0;
let patTimer = null;

function pat() {
  hideControls();
  petpet.classList.add('show');
  setTimeout(() => petpet.classList.remove('show'), 1100);

  patCount += 1;
  clearTimeout(patTimer);
  patTimer = setTimeout(() => (patCount = 0), 5000);

  const star = patCount >= 5;
  hearts.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const h = document.createElement('i');
    h.textContent = star ? ['★', '☆'][i % 2] : ['♥', '♡'][i % 2];
    if (star) h.className = 'star';
    h.style.left = 40 + Math.random() * 60 + '%';
    h.style.setProperty('--dx', (Math.random() * 40 - 20).toFixed(0) + 'px');
    h.style.animationDelay = (i * 0.07).toFixed(2) + 's';
    h.style.fontSize = 11 + Math.random() * 7 + 'px';
    hearts.appendChild(h);
  }
  setTimeout(() => (hearts.innerHTML = ''), 1400);

  const hour = new Date().getHours();
  if (patCount >= 5) {
    say('最喜欢你啦！', 2200);
  } else if (patCount === 3) {
    say('被你摸晕啦～', 1800);
    document.body.classList.add('action-twirl');
    setTimeout(() => document.body.classList.remove('action-twirl'), 700);
  } else if (hour >= 23 || hour < 6) {
    say('这么晚还在摸我，快去睡觉啦～', 2500);
  } else {
    say(['rua～', '好舒服…', '再摸一下嘛', '喵？不对，呜～'][Math.floor(Math.random() * 4)], 1800);
  }
}

/* ---------------- 鼠标交互 ---------------- */

let downPoint = null;
let dragging = false;
let hover = false;
let clickCount = 0;
let clickTimer = null;

function inside(x, y) {
  const r = whale.getBoundingClientRect();
  if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) return true;
  const wb = widgetBtn.getBoundingClientRect();
  if (x >= wb.left - 3 && x <= wb.right + 3 && y >= wb.top - 3 && y <= wb.bottom + 3) return true;
  if (!panel.classList.contains('hide')) {
    const p = panel.getBoundingClientRect();
    if (x >= p.left - 4 && x <= p.right + 4 && y >= p.top - 4 && y <= p.bottom + 4) return true;
  }
  return false;
}

function onTap() {
  clickCount += 1;
  if (clickCount === 1) {
    // 等 260ms 看是不是双击
    clickTimer = setTimeout(() => {
      clickCount = 0;
      showControls();
    }, 260);
  } else {
    clearTimeout(clickTimer);
    clickCount = 0;
    pat();
  }
}

document.addEventListener('mousemove', (e) => {
  if (dragging) return; // 拖动中不要切换命中状态，否则窗口变回穿透会中断拖拽
  const isIn = inside(e.clientX, e.clientY);
  if (isIn !== hover) {
    hover = isIn;
    window.petAPI.setInteractive(isIn);
  }
  document.body.style.cursor = isIn ? 'grab' : 'default';
});

document.addEventListener('mouseleave', () => {
  if (!hover) return;
  hover = false;
  window.petAPI.setInteractive(false);
});

stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest('#panel, #widgetBtn')) return;
  downPoint = { x: e.clientX, y: e.clientY };
  dragging = false;
  stage.setPointerCapture(e.pointerId);
});

stage.addEventListener('pointermove', (e) => {
  if (!downPoint || dragging) return;
  if (Math.hypot(e.clientX - downPoint.x, e.clientY - downPoint.y) > 4) {
    dragging = true;
    setAction('drag');
    hideControls();
    window.petAPI.dragStart({ x: e.screenX, y: e.screenY });
    document.body.style.cursor = 'grabbing';
  }
});

stage.addEventListener('pointerup', (e) => {
  if (!downPoint) return;
  if (dragging) {
    window.petAPI.dragEnd();
    setAction(playing ? 'dance' : 'idle');
    document.body.style.cursor = 'grab';
  } else {
    onTap();
  }
  dragging = false;
  downPoint = null;
  try {
    stage.releasePointerCapture(e.pointerId);
  } catch (_) {}
});

stage.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  hideControls();
  window.petAPI.contextMenu();
});

say('我是 DeepSeek 小鲸鱼~', 3600);
