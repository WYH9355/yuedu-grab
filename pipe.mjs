/**
 * 一条龙：给详情页 URL -> 抓目录 -> 抓正文 -> 装配 -> 净化 -> 验收 -> 输出 TXT -> 可选推手机
 *
 * node pipe.mjs <详情页URL> [--name 书名] [--limit 5] [--jobs 2] [--delay 400] [--push] [--probe]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));   // 脚本所在目录，换 PC / 换盘符都不用改

const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const opt = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const URL_ARG = argv.find(a => /^https?:\/\//.test(a));
if (!URL_ARG) { console.error('用法: node pipe.mjs <详情页URL> [--name 书名] [--limit N] [--jobs 2] [--delay 400] [--push] [--probe]'); process.exit(1); }

const LIMIT = +opt('limit', 0);
const JOBS = Math.max(1, +opt('jobs', 2));
const DELAY = +opt('delay', 400);
const OUTDIR = path.resolve(HERE, opt('out', 'out'));
const BOOKROOT = path.resolve(HERE, opt('books', 'books'));
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
// 支持「第126-127章」「第210-211合章」这类合并章写法
const HEAD_RE = /^第\s*[0-9零一二三四五六七八九十百千两〇]+(?:\s*[-~～—至到]\s*[0-9零一二三四五六七八九十百千两〇]+)?\s*合?\s*[章节回]/;
const CONTENT_HINTS = ['chaptertext', 'chaptercontent', 'rtext', 'novelcontent', 'acontent', 'booktxt', 'htmlContent', 'content1', 'content', 'txt'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function decodeEntities(s) {
  const map = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ldquo: '“', rdquo: '”', mdash: '—', hellip: '…' };
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, k) => {
    if (k[0] === '#') {
      const code = k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : +k.slice(1);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return map[k.toLowerCase()] ?? m;
  });
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h\d|li|tr)>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map(l => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// 按标签配平取容器内部 HTML，避开嵌套 div 截断
function balancedInner(html, startIdx, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = startIdx;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[1]) { depth--; if (depth === 0) return html.slice(startIdx, m.index); }
    else depth++;
  }
  return html.slice(startIdx);
}

function pickContent(html) {
  for (const hint of CONTENT_HINTS) {
    const re = new RegExp(`<(\\w+)\\s[^>]*(?:id|class)\\s*=\\s*["'][^"']*\\b${hint}\\b[^"']*["'][^>]*>`, 'i');
    const m = re.exec(html);
    if (m) {
      const start = m.index + m[0].length;
      const inner = balancedInner(html, start, m[1]);
      const text = htmlToText(inner);
      if (text.length > 200) return { text, hint, tag: m[1] };
    }
  }
  return null;
}

function parseToc(html, base) {
  const list = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = htmlToText(m[2]).replace(/\s+/g, ' ').trim();
    if (!HEAD_RE.test(text) || text.length > 60) continue;
    let href;
    try { href = new URL(decodeEntities(m[1]), base).href; } catch { continue; }
    list.push({ title: text, url: href });
  }
  // 按 URL 去重
  const seen = new Set();
  const uniq = list.filter(c => !seen.has(c.url) && seen.add(c.url));
  // 解析章号，若顺序错乱则按章号重排（站点常把"最新章节"放最前）
  const numOf = t => {
    const s = t.match(/^第\s*([0-9零一二三四五六七八九十百千两〇]+)(?:\s*[-~～—至到]\s*[0-9零一二三四五六七八九十百千两〇]+)?\s*合?\s*[章节回]/)?.[1];
    if (!s) return null;
    if (/^\d+$/.test(s)) return +s;
    const D = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }, U = { 十: 10, 百: 100, 千: 1000 };
    let r = 0, c = 0;
    for (const ch of s) { if (D[ch] !== undefined) c = D[ch]; else if (U[ch]) { r += (c || 1) * U[ch]; c = 0; } }
    return r + c;
  };
  const nums = uniq.map(c => numOf(c.title));
  const scored = nums.filter(n => n !== null).length;
  if (scored >= uniq.length * 0.8) {
    const ordered = nums.every((n, i) => i === 0 || n === null || nums[i - 1] === null || n >= nums[i - 1]);
    if (!ordered) {
      uniq.sort((a, b) => (numOf(a.title) ?? 1e9) - (numOf(b.title) ?? 1e9));
      uniq.reordered = true;
    }
  }
  return uniq;
}

async function getHtml(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate, br' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const head = buf.subarray(0, 2048).toString('latin1').toLowerCase();
  const ctype = (r.headers.get('content-type') || '').toLowerCase();
  const isGbk = /gbk|gb2312|gb18030/.test(head) || /gbk|gb2312/.test(ctype);
  if (isGbk) return new TextDecoder('gbk').decode(buf);
  return buf.toString('utf8');
}

// ---------- 净化 ----------
const AD_LINE = [
  /https?:\/\/\S+/i,
  /\b(?:www\.)?[a-z0-9-]{2,}\.(?:com|net|org|cn|cc|la|tv|info|xyz|top|vip|me|co|tw|io|biz)(?![a-z0-9])/i,
  /(?:本站|域名|永久地址|请记住|加入书签|收藏本站|笔趣阁|顶点小说|最新章节|最快更新|全文阅读|免费阅读|无弹窗|手机阅读|手机版|扫码|公众号|下载APP|章节报错|返回目录|本章未完|请点击下一页|本章阅读完毕|本章已完|本章结束|已是最新章节)/,
];
function cleanText(t) {
  const dropped = [];
  const kept = [];
  for (const raw of t.split(/\n/)) {
    const line = raw.trim();
    if (!line) { kept.push(''); continue; }
    if (/^[\s*=\-_~#·。，、]{5,}$/.test(line) && !/^第\d+章/.test(line)) { dropped.push(line); continue; }
    if (line.length < 80 && AD_LINE.some(re => re.test(line))) { dropped.push(line); continue; }
    kept.push(line);
  }
  const out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, dropped };
}

const slug = s => s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
const numOfTitle = t => t.match(/^第\s*([0-9零一二三四五六七八九十百千两〇]+)(?:\s*[-~～—至到]\s*[0-9零一二三四五六七八九十百千两〇]+)?\s*合?\s*[章节回]/)?.[1] ?? '';

// ---------- 主流程 ----------
const base = URL_ARG;
console.log('探测:', base);
const detailHtml = await getHtml(base);

// 书名 / 简介
const ogName = detailHtml.match(/<meta[^>]+property=["']og:novel:book_name["'][^>]+content=["']([^"']+)/i)?.[1]
  || htmlToText(detailHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '')
  || opt('name', '未命名');
const bookName = opt('name', decodeEntities(ogName).trim());
const intro = htmlToText(detailHtml.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']*)/i)?.[1] || '');

let toc = parseToc(detailHtml, base);
console.log(`书名: ${bookName} | 目录链接: ${toc.length}${toc.reordered ? '（已按章号重排）' : ''}`);

if (flag('probe')) {
  const c = await getHtml(toc[0]?.url || base);
  const picked = pickContent(c);
  console.log('首个章节:', toc[0]?.title, toc[0]?.url);
  console.log('正文容器:', picked ? `#${picked.hint} <${picked.tag}> ${picked.text.length} 字` : '未识别');
  console.log('正文样本:', picked?.text.slice(0, 120).replace(/\n/g, ' / '));
  console.log('\n目录原文顺序（前 120 条）:');
  toc.slice(0, 120).forEach((c, i) => console.log(`  ${String(i + 1).padStart(3)} ${c.title}  ${c.url}`));
  process.exit(0);
}

if (!toc.length) { console.error('未识别到目录链接，用 --probe 看页面结构后改 CONTENT/HEAD 规则'); process.exit(2); }
if (LIMIT) toc = toc.slice(0, LIMIT);

const dir = path.join(BOOKROOT, slug(bookName));
fs.mkdirSync(path.join(dir, 'ch'), { recursive: true });
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ bookName, base, intro, count: toc.length, at: new Date().toISOString() }, null, 2), 'utf8');

// 并发抓正文，落盘可续跑
let done = 0, fail = 0;
const queue = [...toc.entries()];
async function worker() {
  while (queue.length) {
    const [i, ch] = queue.shift();
    const file = path.join(dir, 'ch', String(i + 1).padStart(4, '0') + '.txt');
    if (fs.existsSync(file) && fs.statSync(file).size > 100) { done++; continue; }
    try {
      let html = await getHtml(ch.url);
      let picked = pickContent(html);
      if (!picked) throw new Error('正文容器未命中');
      let text = picked.text;
      // 同章分页：只跟 _N 形式且同前缀
      for (let p = 0; p < 8; p++) {
        // 链接文本常带子标签（如「下一页 <span>›</span>」），必须先去标签再比对
        const nx = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
          .map(a => ({ href: a[1], label: a[2].replace(/<[^>]*>/g, '').replace(/\s+/g, '') }))
          .find(a => /^(下一页|下页)/.test(a.label))?.href;
        if (!nx) break;
        const abs = new URL(nx, ch.url).href;
        const prefix = ch.url.replace(/_\d+(\.[a-z]+)?$/i, '').replace(/(\.[a-z]+)$/i, '');
        // 只认同章的 _N 分页，末页的「下一章」以及邻章链接一律不跟
        if (!/_\d+(\.html?)?$/i.test(abs) || !abs.startsWith(prefix)) break;
        const nh = await getHtml(abs);
        const np = pickContent(nh);
        if (!np) break;
        text += '\n' + np.text;
        html = nh;
        await sleep(DELAY);
      }
      fs.writeFileSync(file, text, 'utf8');
      done++;
      if (done % 20 === 0) console.log(`  已抓 ${done}/${toc.length}`);
    } catch (e) {
      fail++;
      console.log(`  [失败] ${ch.title} ${e.message}`);
    }
    await sleep(DELAY);
  }
}
await Promise.all(Array.from({ length: JOBS }, worker));
console.log(`抓取完成: 成功 ${done} 失败 ${fail} / 共 ${toc.length}`);

// 装配 + 净化
const parts = [];
const droppedAll = [];
const stat = [];
for (let i = 0; i < toc.length; i++) {
  const file = path.join(dir, 'ch', String(i + 1).padStart(4, '0') + '.txt');
  if (!fs.existsSync(file)) continue;
  const { text, dropped } = cleanText(fs.readFileSync(file, 'utf8'));
  droppedAll.push(...dropped);
  // 站点目录常有重号/乱号，输出统一顺延编号，标题取原名去掉章号前缀
  const nameBody = toc[i].title.replace(/^第\s*[0-9零一二三四五六七八九十百千两〇]+(?:\s*[-~～—至到]\s*[0-9零一二三四五六七八九十百千两〇]+)?\s*合?\s*[章节回]\s*[-—:：·、]?\s*/, '').trim();
  const title = nameBody ? `第${i + 1}章 ${nameBody}` : `第${i + 1}章`;
  parts.push(`${title}\n${text}`);
  stat.push({ i: i + 1, title, len: text.replace(/\s/g, '').length });
}

const used = stat.reduce((a, s) => a + s.len, 0);
const empty = stat.filter(s => s.len < 200);
const dupTitle = Object.entries(stat.reduce((a, s) => (a[s.title] = (a[s.title] || 0) + 1, a), {})).filter(([, v]) => v > 1);
const cleanIntro = cleanText(intro || '');
if (cleanIntro.dropped.length) droppedAll.push(...cleanIntro.dropped);
const body = (cleanIntro.text.length >= 20 ? '简介\n' + cleanIntro.text + '\n\n' : '') + parts.join('\n\n');
fs.mkdirSync(OUTDIR, { recursive: true });
const outFile = path.join(OUTDIR, slug(bookName) + '.txt');
fs.writeFileSync(outFile, body.replace(/\n{3,}/g, '\n\n') + '\n', 'utf8');

console.log('\n验收');
console.log('  章数', stat.length, '| 字数', used, '| 平均', Math.round(used / Math.max(1, stat.length)));
console.log('  字数区间', Math.min(...stat.map(s => s.len)), '~', Math.max(...stat.map(s => s.len)));
console.log('  偏短章', empty.length ? empty.map(s => `${s.title}(${s.len})`).slice(0, 10).join(', ') : '无');
console.log('  重名章', dupTitle.length ? JSON.stringify(dupTitle.slice(0, 5)) : '无');
console.log('  净化删除', droppedAll.length, '行', droppedAll.slice(0, 5).map(s => JSON.stringify(s.slice(0, 40))).join(' '));
console.log('  输出', outFile, (fs.statSync(outFile).size / 1048576).toFixed(2) + 'MB');

if (flag('push')) {
  try {
    const dev = execFileSync('adb', ['devices'], { encoding: 'utf8' }).split('\n').filter(l => /\tdevice$/.test(l.trim()));
    if (!dev.length) throw new Error('无 adb 设备');
    execFileSync('adb', ['push', outFile, '/sdcard/Download/'], { stdio: 'inherit' });
    console.log('已推送到 /sdcard/Download/，App 里「本地书籍 → 扫描」即可');
  } catch (e) {
    console.log('adb 推送失败:', e.message);
    console.log('改用 WIFI 传书：App 右上角 ⋮ → WIFI 传书 → 浏览器打开显示的 http://手机IP:1122 上传', outFile);
  }
}
