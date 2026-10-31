'use strict';

/**
 * 歌词抓取：目前走网易云音乐公开接口（搜索 + 歌词），
 * 拿不到就返回 null，由渲染层回退显示歌名。
 */

const https = require('https');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function getJSON(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': UA,
          Referer: 'https://music.163.com/',
          Accept: 'application/json, text/plain, */*',
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('返回格式错误'));
          }
        });
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s·・.,，、'"“”‘’()（）\[\]【】!！?？~～_-]/g, '');
}

/** "001. 海屿你 - 马也_Crabbit" -> { name: '海屿你', artist: '马也_Crabbit' } */
function splitPart(part) {
  let s = String(part || '').trim();
  s = s.replace(/^\s*\d{1,3}\s*[.、．:：_\-]\s*/, '');
  s = s.replace(/【[^】]{0,20}】/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  let name = s;
  let artist = '';
  const m = s.split(/\s+[-–—]\s+/);
  if (m.length >= 2) {
    const head = m[0].trim();
    const tail = m.slice(1).join(' - ').trim();
    if (head && tail) {
      name = head;
      artist = tail;
    }
  }
  name = name.replace(/\s*[（(](live|伴奏|remix|翻自|cover)[^)）]*[)）]\s*$/i, '').trim();
  return { name, artist };
}

class LyricsClient {
  constructor() {
    this.cache = new Map();
  }

  async get({ song, artist, duration }) {
    const part = splitPart(song);
    const name = (artist ? part.name : part.name) || '';
    const by = artist || part.artist || '';
    const key = `${norm(name)}|${norm(by)}|${Math.round(Number(duration) || 0)}`;
    if (this.cache.has(key)) return this.cache.get(key);

    const result = await this.lookup(name, by, Number(duration) || 0);
    this.cache.set(key, result);
    if (this.cache.size > 300) {
      const first = this.cache.keys().next().value;
      this.cache.delete(first);
    }
    return result;
  }

  async lookup(name, artist, duration) {
    const queries = [];
    if (name && artist) queries.push(`${name} ${artist.split(/[、,\/]/)[0]}`);
    if (name) queries.push(name);
    if (name && artist) queries.push(artist.split(/[、,\/]/)[0]);

    for (const q of queries) {
      let songs = [];
      try {
        const res = await getJSON(
          'https://music.163.com/api/search/get?s=' +
            encodeURIComponent(q) +
            '&type=1&limit=8&offset=0'
        );
        songs = (res && res.result && res.result.songs) || [];
      } catch (_) {
        continue;
      }
      const best = this.pick(songs, name, artist, duration);
      if (!best) continue;
      try {
        const ly = await getJSON(
          `https://music.163.com/api/song/lyric?id=${best.id}&lv=1&kv=1&tv=-1`
        );
        const lrc = (ly && ly.lrc && ly.lrc.lyric) || '';
        if (lrc && /\[\d{1,2}:\d{2}/.test(lrc)) {
          return {
            ok: true,
            source: '网易云音乐',
            name: best.name,
            artist: (best.artists || []).map((a) => a.name).join(' / '),
            duration: Math.round((best.duration || 0) / 1000),
            lrc,
          };
        }
      } catch (_) {
        /* 换下一个候选 */
      }
    }
    return { ok: false, name, artist };
  }

  pick(songs, name, artist, duration) {
    if (!songs.length) return null;
    const target = norm(name);
    const by = norm(artist).split(/[、,\/]/)[0];
    const scored = songs.map((s) => {
      const n = norm(s.name);
      let score = 0;
      if (n === target) score += 100;
      else if (n.includes(target) || target.includes(n)) score += 60;
      if (by && norm((s.artists || []).map((a) => a.name).join('')).includes(by)) score += 50;
      const d = Math.abs((s.duration || 0) / 1000 - (duration || 0));
      if (duration && d <= 3) score += 40;
      else if (duration && d <= 8) score += 20;
      else if (duration) score -= Math.min(30, d);
      return { s, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    if (!top || top.score < 60) return null;
    return top.s;
  }
}

module.exports = { LyricsClient, splitPart };
