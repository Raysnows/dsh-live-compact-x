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
