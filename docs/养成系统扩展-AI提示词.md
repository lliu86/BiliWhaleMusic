# BiliWhaleMusic 养成系统扩展 · AI 实现提示词

> 用法：把对应小节的「提示词」原文复制给 AI 编程助手即可。
> 本批功能是**在已有成长系统上的养成深度扩展**（喂食、心情、签到、成就、皮肤），全部基于 GitHub 开源桌宠项目（dsh-whale 饱食度 / Pet Mochi 心情 / terminal-pet 成就连签 / OpenPets 换装）提炼，可直接落地。
> 建议实施顺序：④ 签到 → ① 喂食 → ② 心情 → ⑤ 皮肤 → ③ 成就（④ 改动最小，先闭环）。

---

## 已有系统速览（AI 必读锚点）

- 数据文件：`biuwhale.json`（Store 类在 `src/store.js`，`DEFAULTS` 已含 `listenTotal/listenToday/listenDate/listenWave/petLevel/petExp/listenHistory`；`store.get()/store.set()` 同步读写，改默认值要同时加进 `DEFAULTS`，否则旧数据合并会缺字段）。
- 成长系统已实现：`main.js` 的 `growth()` 用 `listenWave`（听歌秒数）= 音浪值，`level = 1 + Math.floor(Math.sqrt(listenWave / 600))`（约 10 分钟一级），写回 `petLevel/petExp`；`renderer/pet/pet.js` 的 `renderGrow()` 渲染 `growLevel/growWave/growBar/growExp`，升级时 `say('升到 Lv.X 啦…')`，`document.body.classList.toggle('lv3', level >= 3)`。
- 气泡：`pet.js` 的 `say(text, ms)`（带打字机效果）；切歌气泡在 `onPlayback` 里。
- 摸头：`pet.js` 的 `pat()`，双击触发，`patCount` 3 次转圈（`action-twirl`）、5 次星星、深夜提醒。
- 计时：番茄钟已有（`FOCUS_SEC`、`renderTimer`）；听歌累计每 10 秒落盘一次。
- 桌宠 API：`preload-pet.js` 用 `contextBridge.exposeInMainWorld('petAPI', {...})` 暴露，主进程用 `ipcMain.on/handle` 处理，新增 IPC 时三处都要改。
- 文件清单：`src/store.js`、`main.js`、`preload-pet.js`、`renderer/pet/pet.js`、`renderer/pet/index.html`。

---

## ④ 每日签到与连续天数（改动最小，先做）

提示词：

> 在 Electron 桌宠 BiliWhaleMusic（`D:\Users\lenovo\Desktop\豆包对话\BiuWhale`）实现「每日签到 + 连续天数」：每天签到一次领音浪值奖励，连续签到天数递增，漏签归零。
> 涉及文件：`src/store.js`、`main.js`、`preload-pet.js`、`renderer/pet/pet.js`、`renderer/pet/index.html`。
> 现状锚点：`store.js` `DEFAULTS` 已有 `listenWave/petLevel`；`main.js` 已有 `localDay()`（返回 `YYYY-MM-DD` 本地日期）；`pet.js` 有 `say(text, ms)`；面板已有卡片结构（`renderGrow` 用的 `growLevel` 等元素在面板里）。
> 实现要点：
> 1. `store.js` `DEFAULTS` 新增：`checkinDate: ''`（上次签到日期）、`streakDays: 0`（连续天数）、`totalCheckins: 0`（累计签到次数）。
> 2. `main.js` 新增 `ipcMain.handle('pet:checkin', () => { ... })`：取 `localDay()`，与 `checkinDate` 比较——相同则返回 `{ok:false, reason:'already'}`；昨天则 `streakDays+1`；否则 `streakDays=1`；`totalCheckins+1`、`checkinDate=今天`；奖励 `listenWave += 60`（并同步 `petLevel/petExp` 用 `growth()` 现有逻辑重算）；返回 `{ok:true, streakDays, bonus:60, level}`。
> 3. `preload-pet.js` 在 `petAPI` 增加 `checkin: () => ipcRenderer.invoke('pet:checkin')`。
> 4. `index.html` 面板新增签到按钮（`id="checkinBtn"`）与签到信息行（`id="checkinInfo"`）；`pet.js` 里：启动时调用 `petAPI.checkin()` 自动签到（返回 `already` 就静默），`say('签到成功！连续 X 天，+60 音浪～')`；按钮点击重复签到显示「今天已签到啦」气泡。
> 5. 按钮状态：当天已签到时按钮置灰/显示「已签到」，次日 0 点后恢复（用 `checkinDate !== localDay` 判断，日期可从 `petAPI.checkin()` 返回或另加字段）。
> 验收：首次签到 Lv 不变、音浪 +60；连续两天签到 streak=2；漏一天后签到 streak 归 1；当天重复签到不重复加音浪；重启后签到状态保持。

---

## ① 喂食与饱食度（借鉴 dsh-whale-food-expack）

提示词：

> 在 Electron 桌宠 BiliWhaleMusic（`D:\Users\lenovo\Desktop\豆包对话\BiuWhale`）实现「喂食 + 饱食度」：面板增加投喂按钮，点击给鲸鱼喂「音浪零食」，饱食度随时间衰减、听歌时掉得更快，饿了鲸鱼会冒气泡喊饿。
> 涉及文件：`src/store.js`、`main.js`、`preload-pet.js`、`renderer/pet/pet.js`、`renderer/pet/index.html`。
> 现状锚点：`store.js` `DEFAULTS`；`main.js` 已有每 10 秒落盘的听歌计时逻辑（累加 `listenTotal/listenWave` 处）、`growth()`；`pet.js` 有 `say()`、`renderGrow()`、面板元素；桌宠窗口每 10 秒收到主进程统计（`pet:stats`，`renderStats` 消费 `st.listen`）。
> 实现要点：
> 1. `store.js` `DEFAULTS` 新增：`petSatiety: 100`（饱食度 0-100）。
> 2. 衰减逻辑放 `main.js`：在现有 10 秒落盘/统计 tick 里加 `petSatiety = max(0, petSatiety - 0.5)`（约 100 分钟饿空）；**播放中时衰减加倍**（-1.0/tick，听歌费体力）；写回 store。
> 3. 新增 `ipcMain.handle('pet:feed', () => { ... })`：饱食度 < 100 时 `petSatiety = min(100, +30)`，并奖励 `listenWave += 10`（同步 `growth()` 重算等级），返回 `{ok:true, satiety, wave, level}`；已满则 `{ok:false, reason:'full'}`。
> 4. `preload-pet.js` 增加 `feed: () => ipcRenderer.invoke('pet:feed')`。
> 5. `index.html` 面板新增投喂按钮（`id="feedBtn"`）和饱食度条（`id="satietyBar"`，与 `growBar` 样式一致）；`pet.js` 新增 `renderSatiety(s)` 更新条宽；点击按钮调 `petAPI.feed()`，成功 `say('啊呜～吃饱饱，+10 音浪')`，满时 `say('吃不下啦')`。
> 6. 饥饿提醒：`main.js` 在饱食度 ≤ 20 且之前 > 20 时，主动 `petWin.webContents.send('pet:hungry', {satiety})`；`pet.js` 收到后 `say('好饿呀，喂我点音浪零食嘛～')`（限频：收到一次只喊一次，别刷屏）。
> 验收：点投喂饱食度 +30 且音浪 +10；不投喂时数值缓慢下降、听歌时下降更快；≤20 喊一次饿；满 100 拒绝；重启保持。

---

## ② 心情系统（借鉴 Pet Mochi）

提示词：

> 在 Electron 桌宠 BiliWhaleMusic（`D:\Users\lenovo\Desktop\豆包对话\BiuWhale`）实现「鲸鱼心情系统」：由时间与行为驱动 4 种心情，通过 `body.mood-*` 状态类改变表情与气泡风格。
> 涉及文件：`renderer/pet/pet.js`、`renderer/pet/index.html`（主进程如需落盘心情再加 `main.js`/`src/store.js`）。
> 现状锚点：`pet.js` 已有 `onPlayback(state)`（含 playing）、`say()`、`pat()`、`renderGrow()`；已有 `body.action-*`/`lv3` 状态类用法；`index.html` 已有表情/气泡 DOM（`bubble`/`bubbleText`）与 CSS。
> 实现要点：
> 1. `pet.js` 新增 `setMood(mood)`：mood ∈ `happy | cozy | sleepy | lonely`，`document.body.classList` 先移除全部 `mood-*` 再加目标；每 30 秒调用一次 `refreshMood()`。
> 2. 判定规则（优先级从上到下）：`playing === true` → `happy`；本地时间 23:00-06:00 → `sleepy`；`window.petAPI.getStats?.()` 或缓存的上次听歌时间距现在 > 4 小时（无听歌记录则忽略）→ `lonely`；否则 `cozy`。
> 3. `index.html` 增加 CSS：`body.mood-happy .moodFace` 显示开心表情（如 `^ω^`）、气泡背景亮色；`body.mood-cozy` 温和色；`body.mood-sleepy` 眯眼表情（`∪ ∪`）、气泡暗色、鲸鱼浮动动画放慢（`animation-duration` 变长）；`body.mood-lonely` 低落表情（`> <`）与灰调气泡。表情用纯 CSS/文本替换（现有 DOM 里加一个 `#moodFace` 元素即可），不要引入图片素材。
> 4. 心情变化播报限频：只在 mood 切换时 `say`（每次切换最多一句话，例如 lonely→「陪陪我嘛…」、sleepy→「困啦，我先眯一会儿」），同一种心情不重复播报；播报与切歌气泡、歌词气泡互不抢占（复用 `say` 的队列或时间错开）。
> 5. 心情不需要写回 store（实时计算）；如需跨天记录心情日记，可扩展 `listenHistory` 结构，本功能先不做。
> 验收：播放歌曲时是 happy；深夜变 sleepy（表情+动画变慢）；长时间不播放变 lonely；默认 cozy；切换时最多一句气泡；不与切歌/歌词气泡打架。

---

## ⑤ 等级皮肤与装饰解锁（借鉴 dsh-plugin-ascension）

提示词：

> 在 Electron 桌宠 BiliWhaleMusic（`D:\Users\lenovo\Desktop\豆包对话\BiuWhale`）扩展等级解锁系统：把现有单一 `lv3` 状态扩展为多级「皮肤 + 称号 + 装饰」，升级视觉随等级变化。
> 涉及文件：`renderer/pet/pet.js`、`renderer/pet/index.html`（纯前端即可，数据沿用 `petLevel`）。
> 现状锚点：`main.js` `growth()` 产出 `{wave, level, exp, need}`，`pet.js` `renderGrow()` 渲染 Lv 并用 `document.body.classList.toggle('lv3', level >= 3)`；`pet.js` 升级时 `say('升到 Lv.X 啦…')`。
> 实现要点：
> 1. 定义等级表（写死在 `pet.js` 顶部常量 `LEVEL_THEME = { 1: {...}, 3: {...}, 5: {...}, 8: {...}, 12: {...} }`，每个含 `title`（称号）、`bubbleCls`（气泡样式类）、`decoCls`（装饰类））。
> 2. `renderGrow()` 改造：取 `LEVEL_THEME` 中 ≤ 当前等级的最高档，`document.body.classList` 移除旧 `lvN/theme-*` 再加新档；Lv 显示改为「Lv.X · 称号」（如 Lv.3 · 音浪学徒 / Lv.5 · 鲸乐歌者 / Lv.8 · 深海歌姬 / Lv.12 · 海之传说）。
> 3. `index.html` 增加对应 CSS：`body.theme-3 #bubble` 换边框色/圆角；`body.theme-5 #bubble` 加渐变背景；`body.theme-8` 在鲸鱼旁显示一个纯 CSS 装饰（如音符 `♪` 漂浮动画，新增 `#deco` 元素）；`body.theme-12` 装饰升级（双音符+光晕）。全部纯 CSS，不引图。
> 4. 升级播报：沿用现有 `say`，升级文案带上新称号：「升到 Lv.5 啦，获得称号『鲸乐歌者』！」（现有逻辑在 `lastLevel` 比较处，改造它读 `LEVEL_THEME`）。
> 5. 不得改动 `main.js` 的 `growth()` 数值曲线；只消费 `petLevel` 渲染。
> 验收：1-2 级无皮肤；3/5/8/12 级分别出现气泡边框、气泡渐变、音符装饰、双音符光晕；称号随 Lv 显示；升级瞬间播报新称号；重启后等级与皮肤一致。

---

## ③ 成就徽章系统（借鉴 terminal-pet achievements）

提示词：

> 在 Electron 桌宠 BiliWhaleMusic（`D:\Users\lenovo\Desktop\豆包对话\BiuWhale`）实现「成就徽章」：达成听歌/签到/深夜/摸头等条件解锁徽章，解锁时冒气泡，面板可查看已解锁列表。
> 涉及文件：`src/store.js`、`main.js`、`preload-pet.js`、`renderer/pet/pet.js`、`renderer/pet/index.html`。
> 现状锚点：`store.js` `DEFAULTS`（`listenTotal/listenWave/listenToday/listenHistory/streakDays/checkinDate` 等将已存在）；`main.js` `growth()`/10 秒落盘 tick/`recordHistory()`；`pet.js` `say()`、`renderGrow()`、`pat()`（`patCount`）、面板卡片。
> 实现要点：
> 1. `store.js` `DEFAULTS` 新增：`achievements: {}`（键为成就 id，值为解锁时间戳）。
> 2. `main.js` 新增 `ACHIEVEMENTS = [ {id:'first_song', name:'初闻鲸歌', cond: st => st.listenTotal >= 60}, {id:'hour_whale', name:'陪伴一小时', cond: st => st.listenTotal >= 3600}, {id:'night_owl', name:'夜航鲸', cond: st => (st.nightListen || 0) >= 3600}, {id:'streak7', name:'七日之约', cond: st => st.streakDays >= 7}, {id:'pat_lover', name:'摸头狂魔', cond: st => (st.patCount || 0) >= 100}, {id:'lv10', name:'深海传说', cond: st => (st.petLevel || 1) >= 10} ]`；`main.js` 在 10 秒 tick 里跑 `checkAchievements()`：遍历未解锁项，条件满足则 `achievements[id]=Date.now()` 并 `petWin.webContents.send('pet:achievement', {...})`。
> 3. 数据补充：听歌累计里同时累计 `nightListen`（22:00-06:00 播放的秒数）；`pat()` 每摸一次 `patCount+1` 落盘（或累计到 `petPatTotal`）。
> 4. `preload-pet.js` 增加 `achievements: () => ipcRenderer.invoke('pet:achievements')`（返回 `{list, unlocked}` 与全部定义）。
> 5. `index.html` 面板新增成就区（`id="achvList"`，显示徽章名 + 已解锁打勾/未解锁置灰，最多一屏滚动）；`pet.js` 收到 `onAchievement` 时 `say('🎉 解锁成就：' + name)`，并刷新成就列表。
> 验收：听满 1 分钟解锁「初闻鲸歌」并播报；已解锁项重启后仍亮；未满足项置灰且不误报；成就列表可滚动、不撑爆面板。

---

## 交付验收（每个功能完成后统一检查）

1. `node --check main.js && node --check renderer/pet/pet.js` 语法通过；`src/store.js` 改动后 JSON 结构自检。
2. 数据兼容：老用户 `biuwhale.json` 没有新字段时走 `DEFAULTS` 合并，不报错、不丢旧数据。
3. 以 `runtime\nekobiu.exe --no-sandbox --user-data-dir=userdata`（项目目录内）启动验证；面板、气泡、拖拽、切歌均正常。
4. 所有新增 IPC 三处齐全（main.js / preload-pet.js / pet.js 调用点）。
5. 渲染进程不直接 fetch 外部网络（CSP `default-src 'self'` 限制），网络类一律走主进程。
