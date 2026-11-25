/**
 * 文档位置：一律按插件包实际所在的那一层目录算。
 * vendor、node_modules、开发目录、打包进 asar 的副本都走同一套规则，
 * 不写死任何一台机器的用户目录，探不到就如实说"没有"。
 */
import { statSync } from "node:fs";
import { join } from "node:path";

/** 只在真的是普通文件时报"在"：目录同名不算。 */
export function hasFile(target) {
  if (!target) return false;
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

/**
 * 把 CHANGELOG.md 的头几段拆成「版本 / 日期 / 标题 / 要点」。
 * 面板拿它做「本版更新」：升级后第一眼看到的就是这版改了什么，
 * 不用去翻仓库，也不用先知道 1.3.2x 是什么意思。
 */
export function parseChangelog(text, options = {}) {
  const limit = Math.max(1, Number(options.limit) || 2);
  const bulletChars = Math.max(40, Number(options.bulletChars) || 220);
  const source = typeof text === "string" ? text : "";
  const entries = [];
  if (!source) return { entries, truncated: false };
  let current = null;
  for (const raw of source.split(/\r?\n/)) {
    const line = String(raw).trimEnd();
    const head = /^#\s+v?(\d+\.\d+\.\d+)\s*(.*)$/.exec(line);
    if (head) {
      if (current) { entries.push(current); current = null; }
      if (entries.length >= limit) break;
      const rest = head[2].trim();
      const dateMatch = /(\d{4}-\d{2}-\d{2})/.exec(rest);
      const title = rest
        .replace(/^[（(]?\s*/, "")
        .replace(/\s*[）)]$/, "")
        .replace(/^\d{4}-\d{2}-\d{2}\s*/, "")
        .trim();
      current = { version: head[1], date: dateMatch ? dateMatch[1] : "", title, bullets: [] };
      continue;
    }
    if (!current) continue;
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (!bullet) continue;
    const clean = bullet[1].replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    current.bullets.push(clean.length > bulletChars ? clean.slice(0, bulletChars - 1) + "…" : clean);
  }
  if (current && entries.length < limit) entries.push(current);
  return { entries, truncated: entries.length >= limit };
}

/**
 * @param {string} dir 插件包目录（空串表示没解析出来）
 * @param {Record<string, string>} extra 仓库/反馈/版本等一起下发的字段
 */
export function docsFor(dir, extra = {}) {
  const base = typeof dir === "string" ? dir : "";
  const readme = base ? join(base, "README.md") : "";
  const changelog = base ? join(base, "CHANGELOG.md") : "";
  return {
    readme,
    changelog,
    readmeExists: hasFile(readme),
    changelogExists: hasFile(changelog),
    ...extra,
  };
}
