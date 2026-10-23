import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Database } from "../src/auth.js";
export function assertDedicated(url: string, environment: "demo" | "test") {
  const u = new URL(url);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
    decodeURIComponent(u.pathname) !== `/restaurante_${environment}`
  )
    throw new Error(
      `Dedicated loopback restaurante_${environment} database required`,
    );
}
export async function migrate(url: string, environment?: "demo" | "test") {
  if (environment) assertDedicated(url, environment);
  const db = new Database(url);
  try {
    await db.sql.transaction(async (t) => {
      await db.query("SELECT pg_advisory_xact_lock(226002)", [], t);
      const [r] = await db.query(
        "SELECT to_regclass('restaurant.metadata') exists",
        [],
        t,
      );
      if (r?.exists) {
        const [v] = await db.query(
          "SELECT value FROM restaurant.metadata WHERE key='version'",
          [],
          t,
        );
        if (v?.value !== "002") throw new Error("Unknown schema version");
        if (environment) {
          const [e] = await db.query(
            "SELECT value FROM restaurant.metadata WHERE key='environment'",
            [],
            t,
          );
          if (e?.value !== environment)
            throw new Error(
              "Environment marker mismatch; refusing reclassification",
            );
        }
      } else {
        await db.exec(
          await readFile(resolve("migrations/002-access.sql"), "utf8"),
          [],
          t,
        );
        if (environment)
          await db.exec(
            "UPDATE restaurant.metadata SET value=$1 WHERE key='environment'",
            [environment],
            t,
          );
      }
      const [patch] = await db.query(
        "SELECT value FROM restaurant.metadata WHERE key='patch003'",
        [],
        t,
      );
      if (!patch)
        await db.exec(
          await readFile(resolve("migrations/003-logout-proof.sql"), "utf8"),
          [],
          t,
        );
    });
  } finally {
    await db.close();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/db-migrate.ts")) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL required for CLI only");
  const environment = process.argv.includes("--demo")
    ? "demo"
    : process.argv.includes("--test")
      ? "test"
      : undefined;
  migrate(url, environment)
    .then(() =>
      console.log("Migración002+003 completada; sin cuentas automáticas."),
    )
    .catch(() => {
      console.error(
        "Migración rechazada; revisa roles, destino y versión sin exponer URI.",
      );
      process.exitCode = 1;
    });
}
