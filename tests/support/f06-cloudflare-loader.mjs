import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const runtimeModuleUrl = "f06:cloudflare-workers";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: runtimeModuleUrl, shortCircuit: true };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const base = new URL(specifier, context.parentURL);
      for (const suffix of [".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"]) {
        const candidate = new URL(`${base.href}${suffix}`);
        if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === runtimeModuleUrl) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          const runtime = () => globalThis.__MEFFORD_F06_RUNTIME_ENV__ || {};
          export const env = new Proxy({}, {
            get(_target, property) { return runtime()[property]; },
            has(_target, property) { return property in runtime(); },
            ownKeys() { return Reflect.ownKeys(runtime()); },
            getOwnPropertyDescriptor() { return { configurable: true, enumerable: true }; }
          });
        `,
      };
    }
    return nextLoad(url, context);
  },
});
