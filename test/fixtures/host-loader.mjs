const HOST = new Set([
  "@deepseek-ai/dsh-compaction-basic",
  "@deepseek-ai/dsh-compaction",
  "@deepseek-ai/dsh-llm",
]);
export async function resolve(specifier, context, nextResolve) {
  if (HOST.has(specifier)) return { url: new URL("./host-stub.mjs", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
