import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { after, test } from "node:test";
import type { AddressInfo } from "node:net";
import { readConfig } from "../src/config.js";
import { createHttpServer } from "../src/server.js";

const temporaryDirectories: string[] = [];
const temporaryLinks: string[] = [];

after(async () => {
  await Promise.all(temporaryLinks.map((path) => rm(path, { recursive: false, force: true })));
  await Promise.all(temporaryDirectories.map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const container = await mkdtemp(resolve(tmpdir(), "restaurante-test-"));
  temporaryDirectories.push(container);
  const root = resolve(container, "out");
  await mkdir(root);
  await writeFile(resolve(root, "index.html"), "<!doctype html><title>diagnóstico</title>");
  await mkdir(resolve(root, "_next", "static"), { recursive: true });
  await writeFile(resolve(root, "_next", "static", "app.js"), "window.ready = true;");
  await writeFile(resolve(root, ".env.example"), "SECRET=should-not-be-served");
  await writeFile(resolve(root, "package.json"), "{\"private\":true}");
  await writeFile(resolve(root, "next.config.ts"), "export default {};");
  await writeFile(resolve(root, "source.ts"), "export const secret = true;");
  return root;
}

async function withServer(staticRoot: string, mode: "cloud" | "local", run: (origin: string) => Promise<void>) {
  const server = await createHttpServer({ ...readConfig({ RESTAURANTE_MODE: mode }), port: 0 }, { staticRoot });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
      server.closeAllConnections();
    });
  }
}

test("configuration defaults to cloud and loopback, and accepts local mode", () => {
  assert.deepEqual(readConfig({}), { mode: "cloud", host: "127.0.0.1", port: 3000 });
  assert.deepEqual(readConfig({ RESTAURANTE_MODE: "local", PORT: "4321" }), {
    mode: "local",
    host: "127.0.0.1",
    port: 4321,
  });
});

test("explicit invalid mode or port is rejected without echoing the value", () => {
  for (const mode of ["offline", "CLOUD", ""]) {
    assert.throws(() => readConfig({ RESTAURANTE_MODE: mode }), /RESTAURANTE_MODE/);
  }
  for (const port of ["abc", "0", "65536", "-1", "3000;echo unsafe", ""]) {
    assert.throws(() => readConfig({ PORT: port }), (error: unknown) => {
      assert.match(error instanceof Error ? error.message : "", /PORT/);
      const message = error instanceof Error ? error.message : "";
      if (port.length > 0) assert.doesNotMatch(message, new RegExp(port.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return true;
    });
  }
});

test("health reports only the real process status and all unavailable capabilities", async () => {
  const staticRoot = await fixture();
  for (const mode of ["cloud", "local"] as const) {
    await withServer(staticRoot, mode, async (origin) => {
      const response = await fetch(`${origin}/api/health`, { headers: { "Cache-Control": "no-cache" } });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /application\/json/);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        service: "restaurante",
        status: "ok",
        mode,
        capabilities: {
          authentication: false,
          persistence: false,
          businessOperations: false,
          continuity: false,
        },
      });
    });
  }
});

test("context remains denied even when the caller fabricates credentials and scope", async () => {
  const staticRoot = await fixture();
  await withServer(staticRoot, "cloud", async (origin) => {
    const response = await fetch(`${origin}/api/context`, {
      headers: {
        Authorization: "Bearer fabricated-token",
        Cookie: "session=fabricated; tenantId=other-tenant",
        "X-Tenant-Id": "other-tenant",
        "X-Site-Id": "other-site",
      },
    });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: { code: "AUTH_REQUIRED", message: "Autenticación pendiente de implementación." },
    });
  });
});

test("undefined API paths and non-GET methods use the documented JSON errors", async () => {
  const staticRoot = await fixture();
  await withServer(staticRoot, "cloud", async (origin) => {
    const missing = await fetch(`${origin}/api/secret`);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "no-store");
    assert.deepEqual(await missing.json(), { error: { code: "NOT_FOUND", message: "Ruta no encontrada." } });

    for (const path of ["/api/health", "/api/context"]) {
      const response = await fetch(`${origin}${path}`, { method: "POST" });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("allow"), "GET");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        error: { code: "METHOD_NOT_ALLOWED", message: "Método no permitido." },
      });
    }
  });
});

test("static export serves its page but blocks source, configuration, dotfiles, and traversal", async () => {
  const staticRoot = await fixture();
  await withServer(staticRoot, "cloud", async (origin) => {
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /diagnóstico/);

    const asset = await fetch(`${origin}/_next/static/app.js`);
    assert.equal(asset.status, 200);
    assert.match(await asset.text(), /window.ready/);

    for (const path of [
      "/.env.example",
      "/package.json",
      "/next.config.ts",
      "/source.ts",
      "/src/server.ts",
      "/..%2fpackage.json",
    ]) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 404, `${path} should not be served`);
      assert.doesNotMatch(await response.text(), /SECRET=|private|secret = true/);
    }
  });
});

test("static export rejects NTFS alternate streams and internal or external directory junctions", async () => {
  const staticRoot = await fixture();
  const privateDirectory = resolve(staticRoot, ".private");
  const outsideDirectory = resolve(dirname(staticRoot), "outside-export");
  await mkdir(privateDirectory);
  await mkdir(outsideDirectory);
  await writeFile(resolve(privateDirectory, "secret.css"), "private configuration");
  await writeFile(resolve(outsideDirectory, "secret.js"), "outside source");

  const linkType = process.platform === "win32" ? "junction" : "dir";
  const internalLink = resolve(staticRoot, "public-assets");
  const externalLink = resolve(staticRoot, "external-assets");
  await symlink(privateDirectory, internalLink, linkType);
  temporaryLinks.push(internalLink);
  await symlink(outsideDirectory, externalLink, linkType);
  temporaryLinks.push(externalLink);

  await withServer(staticRoot, "cloud", async (origin) => {
    const alternateStream = await fetch(`${origin}/package.json::$DATA`);
    assert.equal(alternateStream.status, 404);
    assert.doesNotMatch(await alternateStream.text(), /private/);

    const privateAsset = await fetch(`${origin}/public-assets/secret.css`);
    assert.equal(privateAsset.status, 404);
    assert.doesNotMatch(await privateAsset.text(), /private configuration/);

    const externalAsset = await fetch(`${origin}/external-assets/secret.js`);
    assert.equal(externalAsset.status, 404);
    assert.doesNotMatch(await externalAsset.text(), /outside source/);
  });
});
