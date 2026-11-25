import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 临时工作目录：先在系统临时目录试，写不进去（受限沙箱常见 EPERM）
 * 就退到仓库下的 .test-tmp。测试不该因为临时目录权限而整份失败。
 */
export function makeTemp(prefix = "spine-") {
  const bases = [tmpdir(), join(process.cwd(), ".test-tmp")];
  for (const base of bases) {
    try {
      mkdirSync(base, { recursive: true });
      return mkdtempSync(join(base, prefix));
    } catch {}
  }
  throw new Error("no writable temp directory");
}
