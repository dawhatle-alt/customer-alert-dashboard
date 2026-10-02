import { readFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/sentiment-watch/config.ts";

const html = readFileSync(path.join(PROJECT_ROOT, "exports", "ssl-cert-product-insights.html"), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)![1]!;

const elements = new Map<string, Record<string, unknown>>();
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]!);
const document = {
  getElementById(id: string) {
    if (!ids.includes(id)) throw new Error(`Missing element #${id}`);
    if (!elements.has(id)) {
      elements.set(id, { innerHTML: "", textContent: "", style: {}, value: "", querySelectorAll: () => [], scrollIntoView() {} });
    }
    return elements.get(id);
  },
};

new Function("document", script)(document);
for (const [id, el] of elements) console.log(`#${id}: ${String(el.innerHTML || el.textContent).length} chars`);
console.log(`Script OK; file size ${(html.length / 1024).toFixed(1)} KB`);
