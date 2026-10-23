import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpServer } from "../src/server.js";
test("auth mutations reject forged origin before authentication or database access", async () => {
  const root = await mkdtemp(join(tmpdir(), "restaurant-auth-"));
  await writeFile(join(root, "index.html"), "test");
  const server = await createHttpServer(
    { mode: "cloud", host: "127.0.0.1", port: 3000 },
    { staticRoot: root },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw Error("address");
    const response = await fetch(
      `http://127.0.0.1:${addr.port}/api/auth/login`,
      {
        method: "POST",
        headers: {
          Origin: "https://forged.invalid",
          "Content-Type": "application/json",
        },
        body: '{"tenantCode":"demo-a","username":"admin","password":"wrong-password"}',
      },
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "FORBIDDEN");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
