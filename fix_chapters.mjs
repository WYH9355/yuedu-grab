import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
if (!SRC) { console.error('用法: node fix_chapters.mjs <源txt> [输出txt] [--target=2800]'); process.exit(1); }
const OUT = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : SRC.replace(/\.txt$/i, '_整理版.txt');
const TARGET = +(process.argv.find(a => a.startsWith('--target='))?.split('=')[1] || 2800);

const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const UNIT = { 十: 10, 百: 100, 千: 1000 };
function toNum(s) {
  if (/^[0-9]+$/.test(s)) return +s;
  let r = 0, cur = 0;
  for (const c of s) {
    if (CN[c] !== undefined) cur = CN[c];
    else if (UNIT[c]) { r += (cur || 1) * UNIT[c]; cur = 0; }
  }
  return r + cur;
}

const text = fs.readFileSync(SRC, 'utf8');
const lines = text.split(/\r?\n/);
const HEAD = /^第([0-9一二三四五六七八九十百千零〇两]+)([章节])\s*(.*)$/;
const clean = s => s.replace(/^[。，、；：！？”’\s]+/, '').replace(/\s+$/, '');

// 1. 切块：章 = 真章起点（带标题）；节 = 站点分页切点（丢弃标题，仅作切分候选）
const blocks = [];
lines.forEach((l, i) => {
  const m = l.trim().match(HEAD);
  if (!m) return;
  blocks.push({ at: i, kind: m[2], num: toNum(m[1]), title: m[3].trim() });
});
blocks.forEach((b, k) => { b.end = blocks[k + 1] ? blocks[k + 1].at : lines.length; });
const segText = b => clean(lines.slice(b.at + 1, b.end).join('\n').trim());

// 2. 组装：章标题开新章，节块并入当前章（但保留为切分点）
const chapters = [];
let cur = null;
const notes = [];
let preface = [];

for (const b of blocks) {
  if (b.kind === '章') {
    const same = cur && b.num === cur.srcNum && b.title && b.title === cur.title;
    if (same) {                                   // 同一章标题重复出现 -> 续页
      cur.segs.push({ cut: true, text: segText(b) });
      notes.push(`合并重复标题「第${b.num}章 ${b.title}」@行${b.at + 1}`);
      continue;
    }
    cur = { srcNum: b.num, title: b.title, segs: [{ cut: false, text: segText(b) }] };
    if (chapters.length === 0 && !preface.done) { chapters.push(null); }
    chapters.push(cur);
  } else {
    if (!cur) { preface.push(segText(b)); continue; }   // 第一个章前的简介
    cur.segs.push({ cut: true, text: segText(b) });
  }
}
const realChapters = chapters.filter(Boolean);

// 3. 补缺章：章号跳号 = 采集时丢了标题，按字数把正文切回 missing+1 段（切点取段落首）
const raw = [];
for (let i = 0; i < realChapters.length; i++) {
  const c = realChapters[i];
  const next = realChapters[i + 1];
  const missing = next && next.srcNum > c.srcNum ? next.srcNum - c.srcNum - 1 : 0;
  const full = c.segs.map(s => s.text).join('\n');
  if (missing === 0 || full.length < (missing + 1) * 400) {
    if (missing) notes.push(`第${c.srcNum}章后缺 ${missing} 章，正文仅 ${full.length} 字，未切分`);
    raw.push({ num: c.srcNum, title: c.title, text: full });
    continue;
  }
  // 切点优先用「节」块边界（站点自身分页），不够再用段落首
  const cuts = [];
  let acc = 0;
  c.segs.forEach((s, k) => { if (k > 0) cuts.push(acc); acc += s.text.length + 1; });
  if (cuts.length < missing) {
    cutsFallback: for (let p = 0; p < full.length; p++) if (full[p] === '\n') cuts.push(p + 1);
  }
  cuts.sort((a, b) => a - b);
  const picked = [];
  let prev = 0;
  for (let k = 1; k <= missing; k++) {
    const ideal = Math.round(full.length * k / (missing + 1));
    let best = -1, bestD = Infinity;
    for (const cp of cuts) {
      if (cp <= prev + 200 || cp >= full.length - 200) continue;
      const d = Math.abs(cp - ideal);
      if (d < bestD) { bestD = d; best = cp; }
    }
    let cp = best > 0 ? best : ideal;
    // 估切点一律推到「句末标点后的第一个段落首」，避免新章以半句开场
    const seg = full.slice(cp, cp + 400);
    const mEnd = seg.search(/[。！？…”’]/);
    if (mEnd >= 0) {
      const nl = full.indexOf('\n', cp + mEnd);
      if (nl > 0 && nl < cp + 600) cp = nl + 1;
    }
    picked.push(cp);
    prev = cp;
  }
  const pieces = [];
  let last = 0;
  for (const cp of picked) { pieces.push(full.slice(last, cp)); last = cp; }
  pieces.push(full.slice(last));
  pieces.forEach((p, k) => raw.push({ num: c.srcNum + k, title: k === 0 ? c.title : '', text: p }));
  notes.push(`第${c.srcNum}章后缺 ${missing} 章 -> 按 ~${Math.round(full.length / (missing + 1))} 字切分为 ${missing + 1} 段`);
}

// 4. 编号归一：保留源编号，重复/回退时顺延
let cursor = 0;
const out = raw.map(c => {
  const n = Math.max(c.num, cursor + 1);
  cursor = n;
  return { ...c, num: n };
});

// 5. 输出
const linesOut = [];
if (preface.length) linesOut.push('简介', preface.filter(Boolean).join('\n\n'), '');
out.forEach(c => {
  linesOut.push(c.title ? `第${c.num}章 ${c.title}` : `第${c.num}章`, c.text.trim(), '');
});
fs.writeFileSync(OUT, linesOut.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n'), 'utf8');

// 6. 验收
const stat = out.map(c => ({ n: c.num, t: c.title, len: c.text.replace(/\s/g, '').length }));
const noTitle = stat.filter(s => !s.t).map(s => s.n);
const short = stat.filter(s => s.len < 1200).map(s => `第${s.n}章(${s.len})`);
const empty = stat.filter(s => s.len === 0).map(s => s.n);
const all = stat.reduce((a, s) => a + s.len, 0);
console.log('源:', path.basename(SRC), '| 块 章', blocks.filter(b => b.kind === '章').length, '节', blocks.filter(b => b.kind === '节').length);
console.log('输出:', path.basename(OUT));
console.log('章节', stat.length, '| 字数', all, '| 平均', Math.round(all / stat.length));
console.log('无标题章', noTitle.length, noTitle.length ? '-> ' + noTitle.join(',') : '');
console.log('空章', empty.length ? empty.join(',') : '无');
console.log('偏短(<1200字)', short.length ? short.join(',') : '无');
console.log('字数区间', Math.min(...stat.map(s => s.len)), '~', Math.max(...stat.map(s => s.len)));
if (notes.length) console.log('处理记录:\n  ' + notes.slice(0, 40).join('\n  ') + (notes.length > 40 ? `\n  ...共 ${notes.length} 条` : ''));
