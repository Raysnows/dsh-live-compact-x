/**
 * 用 PAT 直接发布（GitHub REST API，绕过 git 的 schannel/凭据问题）。
 *
 * 用法（PowerShell）：
 *   $env:GH_TOKEN="ghp_xxx"; node tools/push-with-token.cjs
 * 可选：$env:GH_REPO="dsh-live-compact-x"；$env:GH_PRIVATE="1" 建私有库
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
const REPO = process.env.GH_REPO || "dsh-live-compact-x";
const PRIVATE = process.env.GH_PRIVATE === "1";
if (!TOKEN) { console.error("缺 GH_TOKEN。示例：$env:GH_TOKEN=\"ghp_xxx\"; node tools/push-with-token.cjs"); process.exit(2); }

const H = { authorization: "Bearer " + TOKEN, "user-agent": "dsh-agent", accept: "application/vnd.github+json",
  "content-type": "application/json" };
const api = async (method, path, body) => {
  const r = await fetch("https://api.github.com" + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw new Error(method + " " + path + " -> " + r.status + " " + (json?.message || text.slice(0, 200)));
  return json;
};

const SKIP = new Set([".git", "node_modules"]);
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const me = await api("GET", "/user");
console.log("账号:", me.login);
let repo;
try { repo = await api("GET", "/repos/" + me.login + "/" + REPO); }
catch {
  repo = await api("POST", "/user/repos", { name: REPO, private: PRIVATE, auto_init: false,
    description: "dsh-live-compact fork: net-gain gate + zero-copy v2 store (index + log read-back)" });
  console.log("已创建仓库:", repo.html_url);
}

const files = walk(ROOT);
console.log("文件数:", files.length);
const treeItems = [];
for (const f of files) {
  const rel = relative(ROOT, f).split("\\").join("/");
  const buf = readFileSync(f);
  if (buf.length > 5 * 1024 * 1024) { console.warn("跳过 >5MB:", rel); continue; }
  const blob = await api("POST", "/repos/" + me.login + "/" + REPO + "/git/blobs",
    { content: buf.toString("base64"), encoding: "base64" });
  treeItems.push({ path: rel, mode: "100644", type: "blob", sha: blob.sha });
}
const tree = await api("POST", "/repos/" + me.login + "/" + REPO + "/git/trees", { tree: treeItems });
let parent = null, baseRef = null;
try { baseRef = await api("GET", "/repos/" + me.login + "/" + REPO + "/git/ref/heads/main"); parent = baseRef.object.sha; } catch {}
const message = readFileSync(join(ROOT, ".git", "COMMIT_EDITMSG"), "utf8").trim().split("\n").slice(0, 200).join("\n");
const commit = await api("POST", "/repos/" + me.login + "/" + REPO + "/git/commits",
  { message, tree: tree.sha, ...(parent ? { parents: [parent] } : {}) });
if (baseRef) await api("PATCH", "/repos/" + me.login + "/" + REPO + "/git/refs/heads/main", { sha: commit.sha, force: false });
else await api("POST", "/repos/" + me.login + "/" + REPO + "/git/refs", { ref: "refs/heads/main", sha: commit.sha });
console.log("已发布:", repo.html_url + "/tree/main", "commit", commit.sha.slice(0, 7));
