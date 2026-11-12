import { readFileSync } from "node:fs";
import { DOCS_CSP, renderDocsPage } from "../docs/page.js";
import type { AppContext } from "./context.js";

function packageVersion(): string {
  // Resolves to <repo>/package.json from both src/routes and dist/routes.
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
  return pkg.version;
}

export function registerDocsRoutes({ routes, config }: AppContext): void {
  // Rendered once: the page depends only on configuration.
  const html = renderDocsPage(config, packageVersion());

  routes.add("GET", "/api", (_req, res) => {
    res.set("Content-Security-Policy", DOCS_CSP);
    res.set("Cache-Control", "no-cache");
    res.type("html").status(200).send(html);
  });
}
