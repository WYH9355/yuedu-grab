import fs from 'node:fs';

const SRC = process.argv[2] || '里表综漫-从雾谷伯爵开始的血族领主_整理版.txt';
const t = fs.readFileSync(SRC, 'utf8');

const PATTERNS = [
  ['URL', /https?:\/\/[^\s，。！？”）】]+/g],
  ['域名', /\b(?:www\.)?[a-z0-9-]{2,}\.(?:com|net|org|cn|cc|la|tv|info|xyz|top|vip|me|co|tw|io|biz)\b/gi],
  ['本章未完', /本章未完[^\n]{0,40}/g],
  ['请记住', /请记住[^\n]{0,30}/g],
  ['本站', /本站[^\n]{0,30}/g],
  ['域名词', /域名[^\n]{0,30}/g],
  ['收藏/书签', /(?:收藏本站|加入书签|加入收藏|请收藏)[^\n]{0,25}/g],
  ['站名/平台', /(?:笔趣阁|顶点小说|铅笔小说|新笔趣阁|69书吧|八一中文|燃文|UU看书|全本小说|无弹窗)[^\n]{0,20}/g],
  ['更新提示', /(?:最新章节|最快更新|更新最快|全文阅读|免费阅读)[^\n]{0,20}/g],
  ['手机/扫码', /(?:手机阅读|手机版|扫码|下载APP|关注公众号|微信公众号)[^\n]{0,20}/g],
  ['分页提示', /(?:下一页|上一页|返回目录|章节目录|章节报错|内容加载失败)[^\n]{0,20}/g],
  ['敏感诱导', /(?:请勿模仿|仅供娱乐|本故事纯属虚构)[^\n]{0,20}/g],
  ['异常符号行', /^[\s*=\-_~#·。，、]{5,}$/gm],
];

let total = 0;
for (const [name, re] of PATTERNS) {
  const m = t.match(re) || [];
  const uniq = [...new Set(m.map(s => s.trim()))];
  total += m.length;
  console.log(`[${name}] 命中 ${m.length} | 去重 ${uniq.length}`);
  uniq.slice(0, 8).forEach(u => console.log('    ' + JSON.stringify(u.slice(0, 60))));
}
console.log('\n合计命中', total, '| 文件字符', t.length);

// 可疑行：非中文占比高的短行
const bad = [];
t.split(/\r?\n/).forEach((line, i) => {
  const s = line.trim();
  if (s.length < 3 || s.length > 60) return;
  const latin = (s.match(/[a-zA-Z0-9]/g) || []).length;
  if (latin / s.length > 0.4 && !/^第\d+章/.test(s)) bad.push(`${i + 1}\t${s}`);
});
console.log('\n拉丁字符占比 >40% 的短行', bad.length);
bad.slice(0, 15).forEach(b => console.log('  ' + b));
