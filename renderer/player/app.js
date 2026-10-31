'use strict';

const bridge = window.api;
const $ = (sel) => document.querySelector(sel);
const songName = (item) => (item && (item.song || item.title)) || '';
const songAlbum = (item) => (item && (item.album && item.album !== item.song ? item.album : item.author)) || '';

const audio = new Audio();
audio.preload = 'auto';

const state = {
  view: 'search',
  results: [],
  favorites: [],
  queue: [],
  index: -1,
  playing: false,
  loading: false,
  keyword: '',
  page: 1,
  hasMore: false,
  mode: 'order',
  volume: 0.8,
  current: null,
  lyrics: { key: '', lines: [], active: -1, loading: false, source: '' },
  listen: { total: 0, today: 0, date: '', lastPos: 0, lastSave: 0 },
  settings: { petScale: 1, petAlwaysOnTop: true, showPet: true, closeToTray: false },
  lastSync: 0,
  auth: { isLogin: false },
  favFolders: [],
  favFoldersLoading: false,
  favFolderId: null,
  favItems: [],
  favPage: 1,
  favHasMore: false,
  favLoading: false,
  favFetchedAt: 0,
};

const MODES = [
  { id: 'order', label: '列表循环' },
  { id: 'single', label: '单曲循环' },
  { id: 'shuffle', label: '随机播放' },
];

/* ---------------- 工具 ---------------- */

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtCount(n) {
  if (!n && n !== 0) return '';
  if (n >= 100000000) return (n / 100000000).toFixed(1) + ' 亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + ' 万';
  return String(n);
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function svgIcon(paths, opts = '') {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ${opts}>${paths}</svg>`;
}

/* ---------------- 列表渲染 ---------------- */

function makeCover(item) {
  const img = document.createElement('img');
  img.className = 'cover';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  if (item.pic) {
    img.src = item.pic;
    img.onerror = () => {
      img.removeAttribute('src');
      img.style.background = 'linear-gradient(135deg,#2b3048,#1b1e2c)';
    };
  }
  return img;
}

function isCurrentItem(item) {
  return (
    !!state.current &&
    item.bvid === state.current.bvid &&
    (item.cid || null) === (state.current.cid || null)
  );
}

function rowEl(item, index, opts = {}) {
  const onSelect = opts.onSelect || (() => {});
  const row = document.createElement('div');
  row.className = 'row';
  const isCurrent = isCurrentItem(item);
  if (isCurrent) row.classList.add('active');

  row.appendChild(makeCover(item));

  const main = document.createElement('div');
  main.className = 'row-main';
  const title = document.createElement('div');
  title.className = 'row-title';
  title.textContent = songName(item);
  const sub = document.createElement('div');
  sub.className = 'row-sub';
  const up = document.createElement('span');
  up.className = 'up';
  up.textContent = songAlbum(item);
  const meta = document.createElement('span');
  meta.textContent = item.play ? `${fmtCount(item.play)} 播放` : '';
  sub.append(up, meta);
  main.append(title, sub);
  row.appendChild(main);

  const right = document.createElement('div');
  right.className = 'row-right';
  if (isCurrent && state.playing) {
    const eq = document.createElement('div');
    eq.className = 'eq';
    eq.innerHTML = '<i></i><i></i><i></i>';
    right.appendChild(eq);
  }
  const dur = document.createElement('span');
  dur.className = 'dur';
  dur.textContent = fmtTime(item.duration);
  right.appendChild(dur);

  const fav = document.createElement('button');
  fav.className = 'icon-btn' + (isFav(item) ? ' on' : '');
  fav.title = '收藏';
  fav.innerHTML = svgIcon('<path d="M12 20.3 4.7 13a4.6 4.6 0 0 1 6.5-6.5l.8.8.8-.8A4.6 4.6 0 1 1 19.3 13z"/>');
  fav.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFav(item);
  });
  right.appendChild(fav);
  row.appendChild(right);

  row.addEventListener('click', onSelect);
  return row;
}

function renderContent() {
  const box = $('#content');
  box.innerHTML = '';

  // 有搜索结果时隐藏快捷词，避免列表与快捷词挤在一起
  const showChips = state.view === 'search' && !state.results.length && !state.loading;
  $('#chips').style.display = showChips ? 'flex' : 'none';

  if (state.loading) {
    for (let i = 0; i < 6; i++) {
      const sk = document.createElement('div');
      sk.className = 'skeleton';
      box.appendChild(sk);
    }
    return;
  }

  if (state.view === 'bfav') {
    renderBiliFav(box);
    return;
  }

  if (state.view === 'local') {
    if (!state.favorites.length) {
      box.innerHTML = `<div class="state"><div class="big">🐾</div><div>还没有收藏<br/>点歌曲右侧的心形按钮，把喜欢的歌留下来</div></div>`;
      return;
    }
    state.favorites.forEach((item, i) =>
      box.appendChild(
        rowEl(item, i, {
          onSelect: () => {
            state.queue = state.favorites.slice();
            playAt(i);
          },
        })
      )
    );
    return;
  }

  if (!state.results.length) {
    box.innerHTML = `
      <div class="hero">
        <h2>今天，想听点什么喵？</h2>
        <p>搜索 B 站上的音乐视频，把视频里的音轨直接变成桌面播放器。<br/>多 P 合集会自动展开成播放列表。</p>
        <div class="keys">
          <span class="kbd">空格 播放/暂停</span>
          <span class="kbd">← → 快进 5 秒</span>
          <span class="kbd">单击小鲸鱼 显示控制条</span>
        </div>
      </div>
      <div class="state"><div class="big">🎧</div><div>从上面的搜索框开始吧</div></div>`;
    return;
  }

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 8px 6px;font-size:11px;color:var(--muted)';
  head.innerHTML = `<span>“${escapeHtml(state.keyword)}” 的搜索结果</span><span>${state.results.length} 首</span>`;
  box.appendChild(head);

  state.results.forEach((item, i) =>
    box.appendChild(
      rowEl(item, i, {
        onSelect: () => {
          state.queue = state.results.slice();
          playAt(i);
        },
      })
    )
  );

  if (state.hasMore) {
    const more = document.createElement('button');
    more.className = 'btn';
    more.style.margin = '8px 6px';
    more.textContent = '加载更多';
    more.onclick = () => search(state.keyword, state.page + 1, true);
    box.appendChild(more);
  }
}

function switchTab(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === view);
  });
  const isSearch = view === 'search';
  $('#searchBar').style.display = isSearch ? 'flex' : 'none';
  renderContent();
  if (view === 'bfav' && state.auth.isLogin && !state.favFoldersLoading) {
    // 切回收藏页时，超过 60 秒就自动静默刷新一次，保证和服务端一致
    const stale = !state.favFolders.length || Date.now() - (state.favFetchedAt || 0) > 60000;
    if (stale) loadFolders(false);
  }
}

function updateAccountUI() {
  const a = state.auth || {};
  const btn = $('#btnAccount');
  if (!btn) return;
  btn.classList.toggle('logged', !!a.isLogin);
  const img = $('#acctAvatar');
  if (a.isLogin && a.face) img.src = a.face;
  else img.removeAttribute('src');
  $('#acctName').textContent = a.isLogin ? a.uname || '已登录' : '登录';
  btn.title = a.isLogin ? `已登录：${a.uname || ''}` : '登录 B 站';
}

/* ---------------- B站收藏 ---------------- */

function renderBiliFav(box) {
  if (!state.auth || !state.auth.isLogin) {
    box.innerHTML = `
      <div class="login-card">
        <div class="login-whale">🐳</div>
        <h3>登录 B 站，听自己的收藏</h3>
        <p>登录后可以直接浏览收藏夹里的视频，音质也会更好。<br/>账号信息只保存在本机，不会上传。</p>
        <button class="btn primary" id="btnLogin">登录 B 站</button>
      </div>`;
    $('#btnLogin').onclick = doLogin;
    return;
  }

  const user = document.createElement('div');
  user.className = 'user-bar';
  const avatar = document.createElement('img');
  avatar.className = 'avatar';
  if (state.auth.face) avatar.src = state.auth.face;
  const meta = document.createElement('div');
  meta.className = 'user-meta';
  const name = document.createElement('b');
  name.textContent = state.auth.uname || '已登录';
  const sub = document.createElement('span');
  sub.textContent = `UID ${state.auth.mid || ''}`;
  meta.append(name, sub);
  const logout = document.createElement('button');
  logout.className = 'link-btn';
  logout.textContent = '退出登录';
  logout.onclick = doLogout;
  user.append(avatar, meta, logout);
  box.appendChild(user);

  const bar = document.createElement('div');
  bar.className = 'folder-bar';
  if (state.favFoldersLoading) {
    const s = document.createElement('span');
    s.className = 'muted';
    s.textContent = '加载收藏夹…';
    bar.appendChild(s);
  } else if (!state.favFolders.length) {
    const s = document.createElement('span');
    s.className = 'muted';
    s.textContent = '没有找到收藏夹';
    bar.appendChild(s);
  } else {
    state.favFolders.forEach((f) => {
      const b = document.createElement('button');
      b.className = 'chip' + (f.id === state.favFolderId ? ' on' : '');
      b.textContent = `${f.title} · ${f.count}`;
      b.onclick = () => selectFolder(f.id);
      bar.appendChild(b);
    });
  }
  const rf = document.createElement('button');
  rf.className = 'chip refresh' + (state.favFoldersLoading ? ' spinning' : '');
  rf.title = '刷新收藏夹内容';
  rf.textContent = '↻ 刷新';
  rf.onclick = () => {
    if (!state.favFoldersLoading) loadFolders(true);
  };
  bar.appendChild(rf);
  box.appendChild(bar);

  if (state.favLoading) {
    for (let i = 0; i < 5; i++) {
      const sk = document.createElement('div');
      sk.className = 'skeleton';
      box.appendChild(sk);
    }
    return;
  }

  if (!state.favItems.length) {
    box.innerHTML += `<div class="state"><div class="big">🗂️</div><div>这个收藏夹还是空的</div></div>`;
    return;
  }

  state.favItems.forEach((item, i) => {
    box.appendChild(
      rowEl(item, i, {
        onSelect: () => {
          state.queue = state.favItems.slice();
          playAt(i);
        },
      })
    );
  });

  if (state.favHasMore) {
    const more = document.createElement('button');
    more.className = 'btn';
    more.style.margin = '8px 6px';
    more.textContent = '加载更多';
    more.onclick = () => loadFavItems(state.favPage + 1, true);
    box.appendChild(more);
  }
}

async function doLogin() {
  const r = await bridge.login();
  if (r && r.ok) {
    state.auth = r.user;
    toast(`登录成功：${r.user.uname}`);
    updateAccountUI();
    await loadFolders();
  } else if (r && r.pending) {
    toast('登录窗口已打开');
  } else if (r && r.cancelled) {
    toast('已取消登录');
  } else {
    toast('登录失败，请重试');
  }
  renderContent();
}

async function doLogout() {
  await bridge.logout();
  state.auth = { isLogin: false };
  state.favFolders = [];
  state.favItems = [];
  state.favFolderId = null;
  updateAccountUI();
  toast('已退出 B 站登录');
  renderContent();
}

async function loadFolders(manual = false) {
  state.favFoldersLoading = true;
  renderContent();
  const r = await bridge.favFolders();
  state.favFoldersLoading = false;
  if (r.ok && r.data) {
    state.favFolders = r.data;
    state.favFetchedAt = Date.now();
    if (!state.favFolderId && r.data.length) state.favFolderId = r.data[0].id;
    // 原来选中的收藏夹可能被删了，回退到第一个
    if (state.favFolderId && !r.data.some((f) => f.id === state.favFolderId)) {
      state.favFolderId = r.data.length ? r.data[0].id : null;
    }
    if (manual) toast('收藏夹已刷新');
  } else {
    state.favFolders = [];
    if (r.needLogin) {
      state.auth = { isLogin: false };
      updateAccountUI();
      toast('登录已过期，重新扫码登录一下吧');
    } else {
      toast(r.error || '获取收藏夹失败');
    }
  }
  if (state.favFolderId) await loadFavItems(1, false);
  else renderContent();
}

async function selectFolder(id) {
  if (state.favFolderId === id) return;
  state.favFolderId = id;
  state.favItems = [];
  state.favPage = 1;
  renderContent();
  await loadFavItems(1, false);
}

async function loadFavItems(page = 1, append = false) {
  if (!state.favFolderId) return;
  state.favLoading = !append;
  if (!append) state.favItems = [];
  renderContent();

  const r = await bridge.favList(state.favFolderId, page);
  state.favLoading = false;
  if (!r.ok) {
    toast(r.error || '获取收藏内容失败');
    renderContent();
    return;
  }
  const items = (r.data && r.data.items) || [];
  state.favItems = append ? state.favItems.concat(items) : items;
  state.favPage = page;
  state.favHasMore = !!(r.data && r.data.hasMore);
  renderContent();
  const box = $('#content');
  if (append) box.scrollTop = box.scrollHeight;
  else box.scrollTop = 0;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- 搜索 ---------------- */

async function search(keyword, page = 1, append = false) {
  const kw = String(keyword || '').trim();
  if (!kw) return;
  state.keyword = kw;
  state.page = page;
  state.loading = !append;
  if (!append) state.results = [];
  renderContent();

  const res = await bridge.search(kw, page);
  state.loading = false;
  if (!res.ok) {
    renderContent();
    toast(res.error || '搜索失败');
    return;
  }
  const items = res.data.items || [];
  state.results = append ? state.results.concat(items) : items;
  state.hasMore = items.length >= 20;
  if (!append && state.queue.length === 0) state.queue = state.results.slice();
  renderContent();
  const box = $('#content');
  if (append) box.scrollTop = box.scrollHeight;
  else box.scrollTop = 0;
}

/* ---------------- 播放 ---------------- */

function isFav(item) {
  return state.favorites.some((f) => f.bvid === item.bvid && (f.cid || null) === (item.cid || null));
}

function toggleFav(item) {
  const idx = state.favorites.findIndex((f) => f.bvid === item.bvid && (f.cid || null) === (item.cid || null));
  if (idx >= 0) {
    state.favorites.splice(idx, 1);
    toast('已取消收藏');
  } else {
    state.favorites.unshift({ ...item });
    toast('已加入收藏');
  }
  bridge.storeSet('favorites', state.favorites);
  $('#favCount').textContent = state.favorites.length ? ` ${state.favorites.length}` : '';
  renderContent();
  updateFavButton();
}

async function playAt(index) {
  if (index < 0 || index >= state.queue.length) return;
  const item = state.queue[index];
  if (state.index === index && state.current && audio.src) {
    togglePlay();
    return;
  }

  state.index = index;
  state.current = item;
  state.listen.lastPos = 0;
  renderContent();
  setNowPlaying(item);
  audio.pause();

  try {
    if (!item.cid) {
      const info = await bridge.resolve(item.bvid);
      if (info.ok && info.data.pages.length > 1) {
        const pages = info.data.pages.map((p) => ({
          bvid: info.data.bvid,
          cid: p.cid,
          song: p.part,
          album: info.data.title,
          pageNo: p.page,
          title: p.part,
          author: info.data.author,
          pic: info.data.pic,
          duration: p.duration,
          play: item.play,
        }));
        state.queue.splice(index, 1, ...pages);
        state.current = state.queue[index];
        setNowPlaying(state.current);
      } else if (info.ok) {
        item.cid = info.data.page.cid;
        item.duration = item.duration || info.data.duration;
        item.song = info.data.page.part || info.data.title;
        item.album = info.data.title;
      }
    }

    const song = state.current;
    const res = await bridge.audio(song.bvid, song.cid);
    if (!res.ok) throw new Error(res.error);
    audio.src = res.data.url;
    audio.volume = state.volume;
    await audio.play();
    toast(`正在播放：${res.data.quality === 30280 ? '192K' : res.data.quality === 30232 ? '132K' : '64K'} 音质`);
  } catch (err) {
    toast('播放失败：' + (err.message || '未知错误'));
    setTimeout(() => next(true), 900);
  }
}

/* ---------------- 歌词 ---------------- */

let lyricsToken = 0;

function parseLrc(text) {
  const out = [];
  const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const rows = String(text || '').split(/\r?\n/);
  for (const raw of rows) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\[(ti|ar|al|by|offset|re|ve):/i.test(line)) continue;
    const stamps = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line))) {
      stamps.push(Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number('0.' + m[3]) : 0));
    }
    const content = line.replace(re, '').trim();
    if (!stamps.length || !content) continue;
    if (/^(作词|作曲|编曲|制作人|制作|出品|监制|混音|母带|录音|和声|吉他|贝斯|鼓|键盘|弦乐|统筹|配唱|OP|SP)\s*[:：]/i.test(content)) continue;
    if (/^纯音乐[，,]\s*请欣赏/.test(content)) continue;
    for (const t of stamps) out.push({ t: t, text: content });
  }
  out.sort((a, b) => a.t - b.t);
  return out.filter((item, i) => !i || Math.abs(out[i - 1].t - item.t) > 0.02 || out[i - 1].text !== item.text);
}

function renderLyricsView() {
  const body = $('#lyBody');
  const item = state.current;
  const ly = state.lyrics;
  body.innerHTML = '';
  $('#lyName').textContent = songName(item) || '歌词';

  if (!ly.lines.length) {
    $('#lySource').textContent = ly.loading ? '正在检索' : '暂无歌词';
    const wrap = document.createElement('div');
    wrap.className = 'ly-empty';
    const songEl = document.createElement('div');
    songEl.className = 'song';
    songEl.textContent = songName(item) || '未在播放';
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = ly.loading ? '正在为你找歌词…' : '这首歌还没找到歌词，先听听歌吧';
    wrap.append(songEl, hint);
    body.append(wrap);
    return;
  }

  $('#lySource').textContent = ly.source || '';
  ly.lines.forEach((line, i) => {
    const d = document.createElement('div');
    d.className = 'ly-line';
    d.dataset.i = String(i);
    d.textContent = line.text;
    body.append(d);
  });
  ly.active = -1;
  syncLyrics(true);
}

function syncLyrics(force = false) {
  const ly = state.lyrics;
  if (!ly.lines.length) return;
  const t = (audio.currentTime || 0) + 0.15;
  let lo = 0;
  let hi = ly.lines.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ly.lines[mid].t <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (idx === ly.active && !force) return;
  const body = $('#lyBody');
  const nodes = body.querySelectorAll('.ly-line');
  if (nodes[ly.active]) nodes[ly.active].classList.remove('active');
  ly.active = idx;
  if (bridge.setLyricLine) bridge.setLyricLine(idx >= 0 ? ly.lines[idx].text : '');
  const cur = nodes[idx];
  if (!cur) return;
  cur.classList.add('active');
  if ($('#lyricsPanel').classList.contains('open')) {
    const target = cur.offsetTop - body.clientHeight * 0.42;
    body.scrollTo({ top: Math.max(0, target), behavior: force ? 'auto' : 'smooth' });
  }
}

async function loadLyrics(item) {
  if (!item) return;
  if (bridge.setLyricLine) bridge.setLyricLine('');
  const key = `${item.bvid}:${item.cid || ''}:${songName(item)}`;
  if (state.lyrics.key === key) {
    if (!state.lyrics.loading) renderLyricsView();
    return;
  }
  state.lyrics = { key, lines: [], active: -1, loading: true, source: '' };
  renderLyricsView();
  const token = ++lyricsToken;
  const res = await bridge
    // 只把曲名给歌词服务：歌手从「歌名 - 歌手」里解析，避免把合集名当成歌手
    .lyrics({ song: songName(item), artist: '', duration: item.duration || 0 })
    .catch(() => null);
  if (token !== lyricsToken) return;
  if (res && res.ok && res.lrc) {
    state.lyrics.lines = parseLrc(res.lrc);
    state.lyrics.source = res.source || '';
  }
  state.lyrics.loading = false;
  renderLyricsView();
}

function toggleLyrics(force) {
  const panel = $('#lyricsPanel');
  const open = typeof force === 'boolean' ? force : !panel.classList.contains('open');
  panel.classList.toggle('open', open);
  $('#btnLyrics').classList.toggle('on', open);
  if (open && state.current) {
    loadLyrics(state.current);
    syncLyrics(true);
  }
}

function setNowPlaying(item) {
  $('#pbTitle').textContent = songName(item) || '未在播放';
  $('#pbTitle').title = songName(item) || '';
  const sub = songAlbum(item);
  const pno = item && item.pageNo ? `P${item.pageNo} · ` : '';
  $('#pbSub').textContent = pno + sub;
  const img = $('#pbCover');
  const empty = $('#pbEmpty');
  if (item.pic) {
    img.src = item.pic;
    img.style.display = 'block';
    empty.style.display = 'none';
  } else {
    img.style.display = 'none';
    empty.style.display = 'grid';
  }
  updateFavButton();
  renderQueue();
  loadLyrics(item);
}

function updateFavButton() {
  const btn = $('#btnFav');
  const on = state.current && isFav(state.current);
  btn.classList.toggle('on', !!on);
}

function togglePlay() {
  if (!audio.src) {
    if (state.queue.length) playAt(state.index >= 0 ? state.index : 0);
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function next(auto = false) {
  if (!state.queue.length) return;
  if (state.mode === 'single' && auto) {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  let idx;
  if (state.mode === 'shuffle') {
    if (state.queue.length === 1) idx = 0;
    else {
      do idx = Math.floor(Math.random() * state.queue.length);
      while (idx === state.index);
    }
  } else {
    idx = (state.index + 1) % state.queue.length;
  }
  playAt(idx);
}

function groupKey(item) {
  if (!item) return '';
  if (item.album) return 'album:' + item.bvid + '|' + item.album;
  return 'one:' + item.bvid + ':' + (item.cid || '');
}

/* 跳过当前合集/歌单，直接播放下一个歌单的第一首 */
function nextGroup() {
  if (!state.queue.length) return;
  if (state.index < 0) {
    playAt(0);
    return;
  }
  const key = groupKey(state.queue[state.index]);
  let i = state.index + 1;
  while (i < state.queue.length && groupKey(state.queue[i]) === key) i++;
  if (i >= state.queue.length) {
    toast('已经是最后一个歌单了');
    return;
  }
  const label = state.queue[i].album || state.queue[i].title || '下一个歌单';
  playAt(i);
  toast('切换到歌单：' + label);
}

function prev() {
  if (!state.queue.length) return;
  if (audio.currentTime > 4) {
    audio.currentTime = 0;
    return;
  }
  const idx = (state.index - 1 + state.queue.length) % state.queue.length;
  playAt(idx);
}

/* ---------------- 队列 / 进度 ---------------- */

function renderQueue() {
  const list = $('#queueList');
  const hasGroups = state.queue.some((it) => it.album);
  $('#btnNextGroup').style.display = hasGroups ? '' : 'none';
  list.innerHTML = '';
  $('#queueCount').textContent = state.queue.length ? `· ${state.queue.length} 首` : '';

  if (!state.queue.length) {
    list.innerHTML = '<div class="state" style="padding:36px 10px">队列还是空的</div>';
    return;
  }
  state.queue.forEach((item, i) => {
    const row = rowEl(item, i, { onSelect: () => playAt(i) });
    list.appendChild(row);
  });
}

function updateProgress() {
  const dur = Number.isFinite(audio.duration) ? audio.duration : (state.current?.duration || 0);
  const cur = audio.currentTime || 0;
  const pct = dur ? Math.min(100, (cur / dur) * 100) : 0;
  $('#progressFill').style.width = pct + '%';
  $('#progressDot').style.left = pct + '%';
  $('#tCur').textContent = fmtTime(cur);
  $('#tDur').textContent = fmtTime(dur);
}

function seekTo(clientX) {
  const rect = $('#progress').getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  if (Number.isFinite(audio.duration)) audio.currentTime = ratio * audio.duration;
  updateProgress();
}

/* ---------------- 设置 ---------------- */

function openSettings() {
  bridge.petTempHide(true); // 桌宠置顶会盖住设置弹层，打开时先收起来
  const s = state.settings;
  $('#petScale').value = Math.round((s.petScale || 1) * 100);
  $('#scaleVal').textContent = Math.round((s.petScale || 1) * 100) + '%';
  $('#volume').value = Math.round(state.volume * 100);
  $('#volVal').textContent = Math.round(state.volume * 100) + '%';
  $('#swTop').classList.toggle('on', s.petAlwaysOnTop !== false);
  $('#swShowPet').classList.toggle('on', s.showPet !== false);
  $('#swCloseTray').classList.toggle('on', s.closeToTray === true);
  $('#settingsModal').classList.add('open');
}

function closeSettings() {
  $('#settingsModal').classList.remove('open');
  bridge.petTempHide(false);
}

async function saveSettings() {
  const scale = Number($('#petScale').value) / 100;
  const volume = Number($('#volume').value) / 100;
  const patch = {
    petScale: scale,
    petAlwaysOnTop: $('#swTop').classList.contains('on'),
    showPet: $('#swShowPet').classList.contains('on'),
    closeToTray: $('#swCloseTray').classList.contains('on'),
  };
  const res = await bridge.applySettings(patch);
  if (res && res.ok === false) {
    toast(res.error || '路径不可用');
    return;
  }
  Object.assign(state.settings, patch);
  state.volume = volume;
  audio.volume = volume;
  bridge.storeSet('volume', volume);
  closeSettings();
  toast('设置已保存');
}

/* ---------------- 主进程联动 ---------------- */

let syncTimer = 0;

function localDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function saveListen() {
  bridge.storeSet('listenTotal', Math.round(state.listen.total));
  bridge.storeSet('listenWave', Math.round(state.listen.total)); // 音浪值与累计听歌秒同步
  bridge.storeSet('listenToday', Math.round(state.listen.today));
  bridge.storeSet('listenDate', state.listen.date);
}

function tickListen() {
  const t = audio.currentTime || 0;
  const last = state.listen.lastPos;
  state.listen.lastPos = t;
  if (audio.paused || !audio.src) return;
  const d = t - last;
  if (d <= 0 || d >= 3) return;
  const today = localDate();
  if (state.listen.date !== today) {
    state.listen.date = today;
    state.listen.today = 0;
  }
  state.listen.total += d;
  state.listen.today += d;
  if (Date.now() - state.listen.lastSave > 10000) {
    state.listen.lastSave = Date.now();
    saveListen();
  }
}
function syncPlayback(force = false) {
  const now = Date.now();
  if (!force && now - syncTimer < 1200) return;
  syncTimer = now;
  bridge.setPlayback({
    playing: !audio.paused && !audio.ended && !!audio.src,
    title: songName(state.current),
    artist: songAlbum(state.current),
    cover: state.current?.pic || '',
    position: audio.currentTime || 0,
    duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    hasGroup: state.queue.some((it) => !!it.album),
    author: state.current?.author || '',
    bvid: state.current?.bvid || '',
    cid: state.current?.cid || '',
    page: state.current?.pageNo || 0,
  });
}

/* ---------------- 事件绑定 ---------------- */

function bind() {
  $('#btnSearch').onclick = () => search($('#q').value);
  $('#q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') search($('#q').value);
  });
  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $('#q').value = chip.dataset.q;
    search(chip.dataset.q);
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.onclick = () => switchTab(tab.dataset.view);
  });

  $('#btnPlay').onclick = togglePlay;
  $('#btnNext').onclick = () => next(false);
  $('#btnNextGroup').onclick = () => nextGroup();
  $('#btnPrev').onclick = prev;

  $('#btnAccount').onclick = (e) => {
    e.stopPropagation();
    if (!state.auth.isLogin) {
      doLogin();
      return;
    }
    $('#accountMenu').classList.toggle('show');
  };
  document.addEventListener('click', () => {
    const menu = $('#accountMenu');
    if (menu) menu.classList.remove('show');
  });
  $('#menuFav').onclick = () => {
    $('#accountMenu').classList.remove('show');
    switchTab('bfav');
  };
  $('#menuLogout').onclick = () => {
    $('#accountMenu').classList.remove('show');
    doLogout();
  };

  $('#btnMode').onclick = () => {
    const i = MODES.findIndex((m) => m.id === state.mode);
    state.mode = MODES[(i + 1) % MODES.length].id;
    bridge.storeSet('mode', state.mode);
    toast('播放模式：' + MODES.find((m) => m.id === state.mode).label);
    $('#btnMode').classList.toggle('on', state.mode !== 'order');
  };

  $('#btnQueue').onclick = () => {
    renderQueue();
    $('#drawer').classList.add('open');
  };
  $('#btnCloseQueue').onclick = () => $('#drawer').classList.remove('open');
  $('#btnClearQueue').onclick = () => {
    state.queue = [];
    state.index = -1;
    state.current = null;
    audio.pause();
    audio.removeAttribute('src');
    renderQueue();
    renderContent();
    setNowPlaying({ title: '未在播放', author: '点一首歌，让猫陪你听' });
    toast('队列已清空');
  };

  $('#btnFav').onclick = () => {
    if (state.current) toggleFav(state.current);
    else toast('还没有正在播放的歌曲');
  };

  $('#progress').addEventListener('pointerdown', (e) => {
    seekTo(e.clientX);
    const move = (ev) => seekTo(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  $('#btnLyrics').onclick = () => toggleLyrics();
  $('#btnCloseLyrics').onclick = () => toggleLyrics(false);
  $('#lyBody').addEventListener('click', (e) => {
    const node = e.target.closest('.ly-line');
    if (!node) return;
    const line = state.lyrics.lines[Number(node.dataset.i)];
    if (line) {
      audio.currentTime = line.t;
      syncLyrics(true);
    }
  });
  $('#btnSettings').onclick = openSettings;
  $('#btnCloseSettings').onclick = closeSettings;
  $('#btnCancelSettings').onclick = closeSettings;
  $('#btnSaveSettings').onclick = saveSettings;
  $('#petScale').addEventListener('input', (e) => {
    $('#scaleVal').textContent = e.target.value + '%';
  });
  $('#volume').addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    $('#volVal').textContent = e.target.value + '%';
    audio.volume = v;
  });
  $('#swTop').onclick = (e) => e.currentTarget.classList.toggle('on');
  $('#swShowPet').onclick = (e) => e.currentTarget.classList.toggle('on');
  $('#swCloseTray').onclick = (e) => e.currentTarget.classList.toggle('on');

  $('#btnMin').onclick = () => bridge.minimize();
  $('#btnClose').onclick = () => bridge.hide();

  $('#settingsModal').addEventListener('click', (e) => {
    if (e.target.id === 'settingsModal') closeSettings();
  });

  audio.addEventListener('play', () => {
    state.playing = true;
    $('#icoPlay').style.display = 'none';
    $('#icoPause').style.display = 'block';
    $('#pbCoverBox').classList.add('playing');
    renderContent();
    syncPlayback(true);
  });
  audio.addEventListener('pause', () => {
    saveListen();
    state.playing = false;
    $('#icoPlay').style.display = 'block';
    $('#icoPause').style.display = 'none';
    $('#pbCoverBox').classList.remove('playing');
    renderContent();
    syncPlayback(true);
  });
  audio.addEventListener('timeupdate', () => {
    updateProgress();
    tickListen();
    syncLyrics();
    syncPlayback();
  });
  audio.addEventListener('loadedmetadata', updateProgress);
  audio.addEventListener('ended', () => next(true));
  audio.addEventListener('error', () => {
    if (audio.src) toast('音频加载失败，自动跳下一首');
  });

  window.addEventListener('beforeunload', saveListen);

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowRight') {
      if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
    } else if (e.code === 'ArrowLeft') {
      audio.currentTime = Math.max(0, audio.currentTime - 5);
    }
  });

  bridge.onCommand((cmd) => {
    if (cmd === 'toggle') togglePlay();
    else if (cmd === 'next') next(false);
    else if (cmd === 'prev') prev();
    else if (cmd === 'next-group') nextGroup();
    else if (cmd === 'settings') openSettings();
    else if (cmd === 'search') $('#q').focus();
  });

  bridge.onSettingsChanged((patch) => {
    Object.assign(state.settings, patch);
    if ($('#settingsModal').classList.contains('open')) openSettings();
  });
}

/* ---------------- 启动 ---------------- */

async function boot() {
  bind();

  const saved = await bridge.storeAll();
  state.favorites = saved.favorites || [];
  state.volume = typeof saved.volume === 'number' ? saved.volume : 0.8;
  state.mode = saved.mode || 'order';
  state.settings = {
    petScale: saved.petScale || 1,
    petAlwaysOnTop: saved.petAlwaysOnTop !== false,
    closeToTray: saved.closeToTray === true,
    showPet: saved.showPet !== false,
  };
  const today = localDate();
  state.listen.total = Number(saved.listenTotal) || 0;
  state.listen.today = saved.listenDate === today ? Number(saved.listenToday) || 0 : 0;
  state.listen.date = today;
  audio.volume = state.volume;
  $('#favCount').textContent = state.favorites.length ? ` ${state.favorites.length}` : '';
  $('#btnMode').classList.toggle('on', state.mode !== 'order');

  renderContent();
  renderQueue();
  updateProgress();

  try {
    const auth = await bridge.authState();
    state.auth = auth || { isLogin: false };
    if (auth && auth.offline && auth.isLogin) {
      toast('网络不太稳定，先按已登录状态显示');
    }
  } catch (_) {
    state.auth = { isLogin: false };
  }
  updateAccountUI();

  // 首屏给一点内容，避免空白
  setTimeout(() => {
    if (!state.results.length && !state.loading) search('热门音乐');
  }, 350);
}

boot();

// 调试/自动化截图用：控制台里可以拿到状态、手动切页
window.__biu = { state, renderContent, loadFolders, switchTab, playAt, refreshFavorites: () => loadFolders(true) };
