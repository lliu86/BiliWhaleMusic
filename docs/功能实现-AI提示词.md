# BiuWhale 六个功能 · AI 实现提示词

> 用法：把对应小节的「提示词」原文复制给 AI 编程助手即可。其中「① 情绪系统」「② 弹幕」「④ 哼唱」都依赖前置改动 **P0**（播放状态转发扩展），请让 AI 先做 P0 再做各功能。

---

## 前置改动 P0 · 播放状态转发扩展（所有功能的地基）

提示词：

> 项目是 Electron 桌宠应用 BiuWhale，位于 `D:\Users\lenovo\Desktop\豆包对话\BiuWhale`。
> 现在播放器窗口（`renderer/player/app.js`）通过 `bridge.setPlayback({...})` 发送 `playback:update` 到主进程（`main.js` 第 955 行 `ipcMain.on('playback:update')`），主进程只向桌宠转发 `{playing, title, artist, hasGroup}` 四个字段（`petWin.webContents.send('playback', ...)`）。
> 请把转发字段扩展为：`{playing, title, artist, hasGroup, duration, author, bvid, cid, page}`。
> 做法：① 在 `renderer/player/app.js` 调用 `setPlayback` 的位置（搜索 `setPlayback(`），把 `state.current` 里的 `duration`、`author`、`bvid`、`cid`、`page`（若有）一并放进发送对象；② 在 `main.js` 的 `playback:update` 处理器里，把 `playback.duration / playback.author / playback.bvid / playback.cid` 合并进转发给桌宠的 playback 事件。不要破坏现有 `onPlayback` 在 `renderer/pet/pet.js` 中的既有用法（它已用 title/artist/playing/hasGroup）。

---

## ① 鲸鱼情绪系统（听歌气质切换姿态）

提示词：

> 在 Electron 桌宠 BiuWhale（`D:\Users\lenovo\Desktop\豆包对话\BiuWhale`）实现「鲸鱼情绪系统」：听歌时根据歌曲气质切换姿态，不只摇摆。
> 涉及文件：`renderer/pet/pet.js`、`renderer/pet/index.html`。
> 现状锚点：`pet.js` 已有 `setAction('idle'|'dance'|'drag')`、`window.petAPI.onPlayback(state)`（state 含 title/artist/playing/hasGroup，P0 扩展后含 duration/author）；`index.html` 有 `body.action-idle`（float 动画 3.4s）、`body.action-dance`（dance 动画 0.5s alternate）、`body.action-drag`。
> 实现要点：
> 1. 新增 `setMood(mood)`：mood ∈ `chill | hype | happy`，通过 `document.body.classList.toggle('mood-'+mood)` 切换；保留 `action-*` 结构（动作还是 idle/dance，只是 dance 的动画强度随 mood 变化）。
> 2. 气质判断（启发式即可，放在 pet.js 的 `onPlayback` 里）：标题含「remix / 燃 / 战歌 / 电音 / dance / 蹦迪 / DJ」或时长 ≥ 300 秒→ `hype`；含「抒情 / 温柔 / 安静 / 治愈 / 钢琴 / 纯音乐」→ `chill`；其余默认 `chill`；`hasGroup === false`（本地收藏/单曲）时叠加为 `happy`。
> 3. `index.html` 增加 CSS：`body.mood-hype.action-dance #whale` 用更快更强的摆动（rotate ±6deg、0.28s infinite alternate）；`body.mood-chill.action-dance #whale` 用慢速小幅（rotate ±2deg、1.2s）；`body.mood-happy.action-dance #whale` 加轻微弹跳（translateY -14px 弹跳 keyframes）。暂停时仍回 `idle`（原逻辑不动）。
> 4. 拖拽结束回 `idle/dance` 的逻辑保持 `playing ? 'dance' : 'idle'`，情绪类只影响 dance 动画强度，不影响动作状态机。
> 验收：播放燃曲时鲸鱼快速大幅摆动、抒情曲慢摇、本地收藏单曲弹跳；暂停恢复漂浮；拖动逻辑不受影响。

---

## ② 弹幕氛围播放（鲸鱼吐槽热门弹幕）

提示词：

> 在 Electron 桌宠 BiuWhale（`D:\Users\lenovo\Desktop\豆包对话\BiuWhale`）实现「弹幕氛围」：切歌时鲸鱼从该视频的热门弹幕里挑一条冒气泡「吐槽」。
> 涉及文件：`main.js`（新增 IPC + 弹幕抓取）、`renderer/pet/pet.js`（切歌时请求并 say）。
> 约束：`renderer/pet/index.html` 的 CSP 是 `default-src 'self'`，**桌宠渲染进程不能直接 fetch 外部**，弹幕必须走主进程抓取再 IPC 回传。
> 现状锚点：P0 后 `onPlayback(state)` 有 bvid/cid；`pet.js` 有 `say(text, ms)`；主进程已有 `ipcMain.handle('lyrics:get')` 等 handler 模式可参考。
> 实现要点：
> 1. `main.js` 新增 `ipcMain.handle('pet:danmaku', async (_e, bvid, cid) => ...)`：请求 `https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`（带与 `src/bili.js` 一致的 UA/Referer），解析返回的 XML 里的 `<d p="...">文本</d>`（建议用正则或轻量解析，过滤空文本和重复），返回去重后的弹幕文本数组（最多 200 条）；失败返回 `{ok:false}`。
> 2. 频率限制：同一视频最多请求一次并缓存（Map<cid, list>），避免切歌反复请求触发风控。
> 3. `preload-pet.js` 增加 `danmaku: (bvid, cid) => ipcRenderer.invoke('pet:danmaku', bvid, cid)`。
> 4. `pet.js` 的 `onPlayback` 里，检测到 `changed`（曲名变化）且 bvid/cid 存在时，调 `petAPI.danmaku`，从返回的弹幕里随机挑 1 条（优先选择 5-30 字、非 emoji 密集的），`say('弹幕说：' + text, 4500)`；失败/超时静默忽略，不影响切歌气泡。
> 验收：切歌后鲸鱼气泡出现该视频的一条真实热门弹幕；断网或风控时无报错无弹窗；不重复请求同一视频。

---

## ③ 鲸鱼成长系统（音浪值养成）

提示词：

> 在 Electron 桌宠 BiuWhale（`D:\Users\lenovo\Desktop\豆包对话\BiuWhale`）实现「鲸鱼成长系统」：听歌攒音浪值，喂鲸鱼升级，解锁气泡样式。
> 涉及文件：`src/store.js`、`main.js`（听歌计时累加处、`sampleStats`）、`renderer/pet/pet.js`、`renderer/pet/index.html`。
> 现状锚点：`store.js` 的 `DEFAULTS` 已有 `listenTotal/listenToday/listenDate`（听歌累计秒），`main.js` 中已有累加 `listenTotal` 的计时逻辑（README：每 10 秒落盘一次），`sampleStats` 会把 `listen` 推给桌宠（`pet:stats`，pet.js 的 `renderStats` 读取 `st.listen`）；`index.html` 有 `.card.stat` 卡片（CPU/内存/听歌）。
> 实现要点：
> 1. `store.js` `DEFAULTS` 新增：`listenWave: 0`（音浪值，与 listenTotal 同步增长，单位可同为秒）、`petLevel: 1`、`petExp: 0`、`petLevelAt: 0`（时间戳）。
> 2. `main.js` 计时逻辑：累加 `listenTotal` 的同时累加 `listenWave`；升级规则：`level = 1 + Math.floor(Math.sqrt(listenWave / 600))`（约每 10 分钟升一级，可调），升级时把 `petLevel`/`petExp`（=listenWave % 600）写回 store。
> 3. `sampleStats` 输出新增 `wave/level/exp` 字段；`pet.js` 的 `renderStats` 更新成长卡片显示。
> 4. `index.html` 新增 `.card.grow` 卡片：等级（如「Lv.3」）+ 音浪值进度条（exp/600）+ 累计音浪；样式沿用白底深蓝描边卡片风格（参考 `.card.stat`）。
> 5. 升级反馈：`pet.js` 检测到等级上升时 `say('升到 Lv.'+level+' 啦，继续喂我歌～', 4500)`；等级解锁气泡小样式：Lv≥3 气泡加圆角变体类、Lv≥5 摸头爱心换成星星（`hearts` 里 `♥` 换 `★`）。
> 验收：播放时音浪值/经验增长、进度条可见；达到阈值升级有气泡反馈；重启后等级数据保留（存在 biuwhale.json）。

---

## ④ 歌词哼唱气泡（逐字歌词）

提示词：

> 在 Electron 桌宠 BiuWhale（`D:\Users\lenovo\Desktop\豆包对话\BiuWhale`）实现「歌词哼唱」：播放时鲸鱼气泡逐字显示当前歌词，像在哼唱。
> 涉及文件：`renderer/player/app.js`（歌词高亮循环推送当前行）、`main.js`（转发）、`renderer/pet/pet.js`（逐字打字机）、`renderer/pet/index.html`。
> 现状锚点：`app.js` 歌词面板高亮循环（约第 620 行，`const t = (audio.currentTime || 0) + 0.15;` 附近）已解析 LRC 到 `state.lyrics.lines` 并按时间标 `active`；歌词不存在时只显示曲名；`pet.js` 有 `say(text, ms)`；P0 后 playback 转发字段已扩展。
> 实现要点：
> 1. 新增轻量 IPC：`app.js` 在歌词高亮循环里，当 `active` 行文本变化时（只在该行变化时发送，不要每秒发），调用 `bridge.setLyricLine(lineText)`（`preload-player.js` 新增 `setLyricLine: (text) => ipcRenderer.send('lyric:line', text)`）；无歌词时发送空串。
> 2. `main.js` 新增 `ipcMain.on('lyric:line')`：把文本转发给桌宠窗口（`petWin.webContents.send('lyric:line', text)`，只在文本变化时发送）。
> 3. `preload-pet.js` 新增 `onLyricLine(cb)`；`pet.js` 收到后：非空 → 气泡显示歌词并做逐字打字机（每 70-100ms 追加一个字符，用 `say` 之外的专用渲染，避免 4200ms 自动消失逻辑截断长句；建议新增 `sayLyric(text)`：设置文本、显示气泡，用较长时间 `ms` 或由下一行更新覆盖）；空串 → 气泡显示「♪ 曲名」（恢复原有 `say` 逻辑）。
> 4. 与切歌气泡共存：`onPlayback` 的 `changed` 分支仍显示「♪ 曲名」，之后第一行歌词到达时由歌词覆盖。
> 验收：歌词逐字在鲸鱼气泡中滚动出现；切行流畅不闪烁；无歌词时显示曲名；长句不截断；暂停时歌词停在当前行。

---

## ⑤ 听歌时光机（去年今日）

提示词：

> 在 Electron 桌宠 BiuWhale（`D:\Users\lenovo\Desktop\豆包对话\BiuWhale`）实现「听歌时光机」：鲸鱼偶尔冒泡「去年今日你在听《XX》」。
> 涉及文件：`src/store.js`、`main.js`（记录历史 + 定时触发）、`renderer/pet/pet.js`（say）。
> 现状锚点：`store.js` `DEFAULTS` 有 `listenDate`（跨天归零逻辑）；`main.js` 的 `playback:update`（第 955 行）能感知曲名变化；`pet.js` 的 `say(text, ms)`。
> 实现要点：
> 1. `store.js` `DEFAULTS` 新增 `listenHistory: {}`：结构 `{ "YYYY-MM-DD": [{t: <时间戳>, title, artist}] }`；每天最多存 50 条（超出丢旧），防文件膨胀。
> 2. `main.js`：在 `playback:update` 里，当 `title` 变化且非空时，把 `{t: Date.now(), title, artist}` 追加进今天的数组并落盘（复用 store 的 schedule/flush）。
> 3. 触发：主进程启动后 3 分钟、之后每小时整点检查一次：取「去年今天」（去年同月同日）的记录，若存在且非空，随机挑一条，通过新 IPC `pet:flashback` 发给桌宠；`pet.js` 新增 `onFlashback` 监听，`say('📅 去年今日你在听《'+title+'》', 6000)`（若无去年记录则跳过，不打扰）。
> 4. 只在「去年今日有记录」时触发，没有就安静。
> 验收：今天听的歌会写入 `biuwhale.json` 的 `listenHistory`；日期正确；数据量有上限；桌宠能弹出「去年今日」气泡（可用改系统日期或预置历史数据验证）。

---

## ⑥ 摸头彩蛋（连摸反馈 + 深夜提醒）

提示词：

> 在 Electron 桌宠 BiuWhale（`D:\Users\lenovo\Desktop\豆包对话\BiuWhale`）实现「摸头彩蛋」：连续摸头递增反馈，深夜摸头提醒睡觉。
> 涉及文件：`renderer/pet/pet.js`、`renderer/pet/index.html`。
> 现状锚点：`pet.js` 的 `onTap()`（260ms 双击判定，第二击调 `pat()`）；`pat()` 已有 `petpet.classList.add('show')`（rua.gif）+ 6 颗随机爱心（`hearts`）+ 随机话气泡（`say(['rua～','好舒服…',...], 1800)`）；`index.html` 有 `#hearts i` 的 `heartUp` 动画、`#petpet.show`。
> 实现要点：
> 1. `pet.js` 新增模块级 `patCount = 0`；在 `pat()` 内自增，并设置 5 秒重置定时器（`setTimeout(() => patCount = 0, 5000)`）。
> 2. 连摸反馈（叠加在现有爱心上）：
>    - `patCount === 3`：`say('被你摸晕啦～')`，给 `#whale` 加一次性转圈动画（新增 CSS `body.action-twirl #whale { animation: twirl 0.6s ease; }` + `@keyframes twirl { to { transform: rotate(360deg); } }`，JS 里 `document.body.classList.add('action-twirl')` 并 700ms 后移除，注意结束后恢复当前动作类）；
>    - `patCount >= 5`：爱心换成星星（`hearts` 里的 `♥/♡` 改为 `★/☆`，颜色改金色 `#f5c542`），并 `say('最喜欢你啦！', 2200)`。
> 3. 深夜提醒：`pat()` 里判断 `const h = new Date().getHours();`，若 `h >= 23 || h < 6`，把随机话替换为 `say('这么晚还在摸我，快去睡觉啦～', 2500)`。
> 4. 不改变 `onTap` 的单击/双击语义（面板开关不受影响）。
> 验收：连续摸 3 次出现转圈+特殊气泡；5 次出现星星；23 点后摸头提示睡觉；面板单击开关功能不变。
