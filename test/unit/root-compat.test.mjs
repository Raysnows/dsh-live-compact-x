import { rootContext, warnCompactionStandDown } from "../../src/engine/gate.js";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + " " + x); } };

const ROOT = Symbol.for("cordis.root");

/** 复刻 Cordis 4.0.0-rc.12 的 context Proxy：读未登记的字符串属性直接抛错。 */
function rc12Context({ root = null, parent = null, allow = [] } = {}) {
  const target = { [ROOT]: root, parent, inject: [], fiber: null, logger: { warn() {} } };
  const allowed = new Set(["inject", "fiber", "logger", "get", "on", "effect", "reflect", ...allow]);
  return new Proxy(target, {
    get(t, prop) {
      if (prop === ROOT) return t[prop];
      if (typeof prop === "symbol") return t[prop];
      if (allowed.has(prop)) return t[prop];
      throw new Error('cannot get property "' + String(prop) + '" without inject');
    },
    has() { return true; },
  });
}

console.log("1. rc.12：从 symbol 取 root，绝不读字符串属性");
{
  const root = { name: "root" };
  const ctx = rc12Context({ root, parent: { name: "parent" } });
  let value = null, threw = "";
  try { value = rootContext(ctx); } catch (e) { threw = String(e?.message || e); }
  ok(threw === "", "不抛错：" + threw);
  ok(value === root, "拿到 symbol 上的根上下文");
}

console.log("2. rc.12 且没有 symbol 时退回自身（也不抛）");
{
  const ctx = rc12Context({});
  let value = null, threw = "";
  try { value = rootContext(ctx); } catch (e) { threw = String(e.message || e); }
  ok(threw === "", "读不到 root 也不炸：" + threw);
  ok(value === ctx, "退回传入的 ctx");
}

console.log("3. 旧宿主：仍认 ctx.root");
{
  const root = { name: "old-root" };
  ok(rootContext({ root }) === root, "字符串 root 兼容");
  ok(rootContext({}) !== null && typeof rootContext({}) === "object", "没有 root 时返回自身");
  ok(rootContext(null) === null && rootContext(undefined) === undefined, "空值原样返回");
}

console.log("4. 让位检查在 rc.12 下也能跑完（原来 gate.js:197 会先炸）");
{
  const ctx = rc12Context({ root: { name: "root" } });
  let threw = "";
  try { warnCompactionStandDown(ctx); } catch (e) { threw = String(e.message || e); }
  ok(threw === "", "warnCompactionStandDown 不抛：" + threw);
}

console.log("\n通过 " + pass + " / 失败 " + fail);
if (fail) process.exitCode = 1;
