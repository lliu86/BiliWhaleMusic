'use strict';

/**
 * B 站 Web API 客户端（主进程侧）
 * - 自动获取 buvid3 / buvid4
 * - WBI 签名（w_rid + wts）
 * - 搜索、视频详情、音频流解析
 * 参考 Biu (wood3n/biu) 的接口用法，代码为独立实现。
 */

const crypto = require('crypto');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const REFERER = 'https://www.bilibili.com/';

// WBI 混淆表
const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

const TIMEOUT_MS = 10000;

/** fetch 统一超时：超时中止请求，避免接口挂住导致搜索/播放/登录卡死 */
function fetchTimeout(url, opts = {}, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function mixinKey(orig) {
  return MIXIN_TAB.map((i) => orig[i]).join('').slice(0, 32);
}

class BiliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class BiliClient {
  constructor() {
    this.cookie = '';
    this.wbi = null;
    this.wbiAt = 0;
    this._ready = null;
  }

  setCookie(cookie) {
    this.cookie = String(cookie || '').trim();
  }

  /** 当前生效的 cookie 串（含服务端下发的 buvid 等） */
  getCookie() {
    return this.cookie;
  }

  /** 从 Set-Cookie 里捕获需要的字段 */
  _absorbCookies(res) {
    const list =
      typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const raw of list) {
      const kv = raw.split(';')[0];
      const eq = kv.indexOf('=');
      if (eq <= 0) continue;
      const name = kv.slice(0, eq).trim();
      if (!/^(buvid3|buvid4|b_nut|buvid_fp|SESSDATA|bili_jct|DedeUserID)$/.test(name)) continue;
      this.cookie = this.cookie.replace(new RegExp(`(^|;\\s*)${name}=[^;]*`), `$1${kv}`);
      if (new RegExp(`(^|;\\s*)${name}=`).test(this.cookie)) continue;
      this.cookie = this.cookie ? `${this.cookie}; ${kv}` : kv;
    }
  }

  async _json(url, { needWbi = false, params = {} } = {}) {
    await this.ready();
    const doFetch = async () => {
      let finalUrl = url;
      if (needWbi) {
        finalUrl += (url.includes('?') ? '&' : '?') + this.sign(params);
      }
      const res = await fetchTimeout(finalUrl, {
        headers: {
          'User-Agent': UA,
          Referer: REFERER,
          Origin: 'https://www.bilibili.com',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          Cookie: this.cookie,
        },
      });
      this._absorbCookies(res);
      if (!res.ok) throw new BiliError(res.status, `网络错误 HTTP ${res.status}`);
      return res.json();
    };
    let j = await doFetch();
    // 风控码统一处理：刷新票据后重试一次（-352 票据失效 / -412 请求被拦截）
    if (j && (j.code === -352 || j.code === -412)) {
      this._ready = null;
      this.wbi = null;
      try {
        await this.ready();
      } catch (_) {
        /* 刷新失败就按原结果返回 */
      }
      j = await doFetch();
    }
    return j;
  }

  /** 首次调用：拿 buvid3、WBI key */
  async ready() {
    if (!this._ready) {
      this._ready = this._bootstrap().catch((e) => {
        this._ready = null;
        throw e;
      });
    }
    return this._ready;
  }

  async _bootstrap() {
    if (!/(^|;\s*)buvid3=/.test(this.cookie)) {
      try {
        const res = await fetchTimeout('https://api.bilibili.com/x/frontend/finger/spi', {
          headers: { 'User-Agent': UA, Referer: REFERER },
        });
        const j = await res.json();
        if (j.code === 0 && j.data && j.data.b_3) {
          const extra = `buvid3=${j.data.b_3}; buvid4=${j.data.b_4}`;
          this.cookie = this.cookie ? `${this.cookie}; ${extra}` : extra;
        }
      } catch (_) {
        /* 拿不到就继续，大概率仍可用 */
      }
    }
    await this._refreshWbi();
    if (!this.wbi) throw new BiliError(-1, '初始化 B 站接口失败');
  }

  async _refreshWbi() {
    const res = await fetchTimeout('https://api.bilibili.com/x/web-interface/nav', {
      headers: { 'User-Agent': UA, Referer: REFERER, Cookie: this.cookie },
    });
    const j = await res.json();
    this._absorbCookies(res);
    const img = j?.data?.wbi_img?.img_url;
    const sub = j?.data?.wbi_img?.sub_url;
    if (!img || !sub) return;
    const name = (u) => u.split('/').pop().split('.')[0];
    this.wbi = mixinKey(name(img) + name(sub));
    this.wbiAt = Date.now();
  }

  /** 生成 w_rid 签名串 */
  sign(params) {
    const wts = Math.round(Date.now() / 1000);
    const all = { ...params, wts };
    const query = Object.keys(all)
      .sort()
      .map((k) => {
        const v = String(all[k]).replace(/[!'()*]/g, '');
        return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
      })
      .join('&');
    return `${query}&w_rid=${md5(query + this.wbi)}`;
  }

  /** 搜索视频 */
  async search(keyword, page = 1) {
    const params = {
      search_type: 'video',
      keyword,
      page,
      page_size: 30,
      order: 'totalrank',
    };
    const j = await this._json('https://api.bilibili.com/x/web-interface/wbi/search/type', {
      needWbi: true,
      params,
    });
    if (j.code !== 0) throw new BiliError(j.code, j.message || '搜索失败');
    const list = (j.data?.result || []).filter((v) => v.type === 'video' && v.bvid);
    return {
      page,
      total: j.data?.numResults || 0,
      items: list.map((v) => ({
        bvid: v.bvid,
        title: String(v.title || '').replace(/<[^>]+>/g, ''),
        author: v.author,
        pic: normalizePic(v.pic),
        duration: parseDuration(v.duration),
        play: v.play,
        pubdate: v.pubdate,
      })),
    };
  }

  /** 视频详情 + 分P + 第一段音频 */
  async resolve(bvid) {
    const j = await this._json(
      `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`
    );
    if (j.code !== 0) throw new BiliError(j.code, j.message || '获取视频信息失败');
    const d = j.data;
    const pages = (d.pages || []).map((p) => ({
      cid: p.cid,
      page: p.page,
      part: p.part || d.title,
      duration: p.duration,
    }));
    const first = pages[0] || { cid: d.cid, duration: d.duration, part: d.title };
    return {
      bvid: d.bvid,
      title: d.title,
      author: d.owner?.name || '',
      pic: normalizePic(d.pic),
      duration: first.duration,
      pages,
      page: { cid: first.cid, duration: first.duration, part: first.part, index: 0 },
    };
  }

  /** 登录状态 / 用户信息 */
  async navInfo() {
    const j = await this._json('https://api.bilibili.com/x/web-interface/nav');
    const d = j.data || {};
    return {
      isLogin: !!d.isLogin,
      mid: d.mid ? Number(d.mid) : 0,
      uname: d.uname || '',
      face: normalizePic(d.face || ''),
      vip: d.vipStatus === 1,
    };
  }

  /** 我创建的收藏夹列表 */
  async favFolders(mid) {
    const j = await this._json(
      `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${encodeURIComponent(mid)}&web_location=333.1387`
    );
    if (j.code !== 0) throw new BiliError(j.code, j.message || '获取收藏夹失败');
    const list = (j.data && j.data.list) || [];
    return list.map((f) => ({
      id: f.id,
      title: f.title,
      count: f.media_count || 0,
    }));
  }

  /** 收藏夹内容（视频） */
  async favList(mediaId, pn = 1, ps = 20) {
    const j = await this._json(
      `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${encodeURIComponent(
        mediaId
      )}&pn=${pn}&ps=${ps}&platform=web&order=mtime&type=0&tid=0`
    );
    if (j.code !== 0) throw new BiliError(j.code, j.message || '获取收藏内容失败');
    const d = j.data || {};
    const items = (d.medias || [])
      .filter((m) => m && m.bvid)
      .map((m) => ({
        bvid: m.bvid,
        title: m.title,
        author: (m.upper && m.upper.name) || '',
        pic: normalizePic(m.cover || ''),
        duration: m.duration,
        play: m.cnt_info ? m.cnt_info.play : 0,
      }));
    return {
      info: d.info ? { title: d.info.title, count: d.info.media_count } : null,
      items,
      hasMore: !!d.has_more,
    };
  }

  /** 取某分P的最佳音频流地址（-352/-412 已在 _json 统一刷新重试） */
  async audioUrl(bvid, cid) {
    const params = { bvid, cid, fnval: 16, fnver: 0, fourk: 1 };
    const j = await this._json('https://api.bilibili.com/x/player/wbi/playurl', {
      needWbi: true,
      params,
    });
    if (j.code !== 0) throw new BiliError(j.code, j.message || '获取播放地址失败');
    const dash = j.data?.dash;
    const audios = dash?.audio || [];
    if (!audios.length) throw new BiliError(-1, '该视频没有可用的音频流');
    // 30280 > 30232 > 30216，优先高码率
    audios.sort((a, b) => (b.id || 0) - (a.id || 0));
    const best = audios[0];
    const backupList = best.backupUrl || best.backup_url || [];
    const primary = best.baseUrl || best.base_url;
    // 去重后的候选源（主源优先，backup 兜底；baseUrl 为空时直接用 backup）
    const urls = [...new Set([primary, ...backupList].filter(Boolean))].slice(0, 4);
    if (!urls.length) throw new BiliError(-1, '该视频没有可用的音频流');
    return {
      url: urls[0],
      backup: urls[1] || null,
      urls,
      quality: best.id,
      bandwidth: best.bandwidth,
      mime: best.mimeType || best.mime_type,
    };
  }
}

function normalizePic(pic) {
  if (!pic) return '';
  if (pic.startsWith('//')) return 'https:' + pic;
  if (pic.startsWith('http://')) return pic.replace('http://', 'https://');
  return pic;
}

function parseDuration(v) {
  if (typeof v === 'number') return v;
  const parts = String(v || '0').split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(v) || 0;
}

module.exports = { BiliClient, BiliError };
