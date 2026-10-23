import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { readConfig } from "../src/config.js";
import { createHttpServer } from "../src/server.js";

test("actual Next export is served by the Node HTTP backend", async () => {
  const staticRoot = resolve(process.cwd(), "out");
  const html = await readFile(resolve(staticRoot, "index.html"), "utf8");
  const assetPath = html.split('src="').slice(1).map((part) => part.split('"')[0]).find((path) => path.includes("_next/static/") && (path.endsWith(".js") || path.endsWith(".css")));
  assert.ok(assetPath, "Next export should contain a generated JS or CSS asset");

  const server = await createHttpServer({ ...readConfig({}), port: 0 }, { staticRoot });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /restaurante/i);
    const asset = await fetch(new URL(assetPath!, origin));
    assert.equal(asset.status, 200);
    assert.ok(Number(asset.headers.get("content-length")) > 0);
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
      server.closeAllConnections();
    });
  }
});
