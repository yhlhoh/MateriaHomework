// 生成 public/version.txt，格式为「日期 + 提交」：26.9.16 7a82fc4
// 应用启动时会 fetch /version.txt 与本地记录比对，决定要不要弹「更新日志」。
// 用 Node 而不是 shell 的 date/重定向，保证 Windows / macOS / Linux 行为一致。
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const now = new Date();
const date = `${String(now.getFullYear()).slice(2)}.${now.getMonth() + 1}.${now.getDate()}`;

let hash = '';
try {
  hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
} catch (err) {
  // 打包环境里没有 .git（例如从 tar 包构建）时不写提交号，只留日期
  console.warn('write-version: 取不到 git 提交号，只写日期');
}

const version = hash ? `${date} ${hash}` : date;
writeFileSync('public/version.txt', `${version}\n`);
console.log(`version.txt -> ${version}`);
