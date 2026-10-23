import { createHash } from "node:crypto";
import { Database, hashPassword } from "../src/auth.js";
import { bootstrap, stableId } from "./bootstrap-tenant.js";
import { assertDedicated } from "./db-migrate.js";
import type { Transaction } from "sequelize";
export const DEMO_PASSWORD = "RestauranteDemo2026!";
async function fingerprint(db: Database, t: Transaction) {
  const all = [];
  for (const table of [
    "tenants",
    "sites",
    "users",
    "roles",
    "role_permissions",
    "user_roles",
    "user_sites",
  ]) {
    const rows = await db.query(
      `SELECT to_jsonb(r) row FROM restaurant.${table} r ORDER BY to_jsonb(r)::text`,
      [],
      t,
    );
    all.push([table, rows]);
  }
  return createHash("sha256").update(JSON.stringify(all)).digest("hex");
}
export async function seedDemo(url: string) {
  assertDedicated(url, "demo");
  const db = new Database(url);
  try {
    return await db.sql.transaction(async (t) => {
      await db.query("SELECT pg_advisory_xact_lock(226002)", [], t);
      const [marker] = await db.query(
        "SELECT value FROM restaurant.metadata WHERE key='environment'",
        [],
        t,
      );
      if (marker?.value !== "demo") throw new Error("Demo marker required");
      const [snapshot] = await db.query(
        "SELECT value FROM restaurant.metadata WHERE key='demo_fingerprint'",
        [],
        t,
      );
      if (snapshot) {
        if (snapshot.value !== (await fingerprint(db, t)))
          throw new Error("Demo manually modified; refusing overwrite");
        return;
      }
      if (
        (await db.query("SELECT id FROM restaurant.tenants LIMIT 1", [], t))
          .length
      )
        throw new Error("Empty dedicated demo required");
      for (const [code, name] of [
        ["demo-a", "Restaurante Ficticio A"],
        ["demo-b", "Restaurante Ficticio B"],
      ]) {
        const a = await bootstrap(
          db,
          {
            code: code!,
            name: name!,
            siteCode: "principal",
            siteName: "Local principal",
            username: "admin",
            password: DEMO_PASSWORD,
            deterministic: true,
          },
          t,
        );
        const limited = stableId(`${code}:limited`),
          disabled = stableId(`${code}:disabled`),
          role = stableId(`${code}:limited-role`);
        await db.exec(
          "INSERT INTO restaurant.roles(id,tenant_id,name) VALUES($1,$2,'Consulta')",
          [role, a.tenantId],
          t,
        );
        await db.exec(
          "INSERT INTO restaurant.role_permissions(tenant_id,role_id,permission) VALUES($1,$2,'auditoria.consultar')",
          [a.tenantId, role],
          t,
        );
        const hash = await hashPassword(DEMO_PASSWORD);
        for (const [id, username, active] of [
          [limited, "consulta", true],
          [disabled, "inactivo", false],
        ]) {
          await db.exec(
            "INSERT INTO restaurant.users(id,tenant_id,username,password_hash,active) VALUES($1,$2,$3,$4,$5)",
            [id, a.tenantId, username, hash, active],
            t,
          );
          await db.exec(
            "INSERT INTO restaurant.user_roles(tenant_id,user_id,role_id) VALUES($1,$2,$3)",
            [a.tenantId, id, role],
            t,
          );
          await db.exec(
            "INSERT INTO restaurant.user_sites(tenant_id,user_id,site_id) VALUES($1,$2,$3)",
            [a.tenantId, id, a.siteId],
            t,
          );
        }
        if (code === "demo-a") {
          const second = stableId(`${code}:second-site`);
          await db.exec(
            "INSERT INTO restaurant.sites(id,tenant_id,code,name) VALUES($1,$2,'secundario','Segundo local ficticio')",
            [second, a.tenantId],
            t,
          );
          await db.exec(
            "INSERT INTO restaurant.user_sites(tenant_id,user_id,site_id) VALUES($1,$2,$3)",
            [a.tenantId, a.userId, second],
            t,
          );
        }
      }
      await db.exec(
        "INSERT INTO restaurant.metadata(key,value) VALUES('demo_fingerprint',$1)",
        [await fingerprint(db, t)],
        t,
      );
    });
  } finally {
    await db.close();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/seed-demo.ts")) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL required");
  seedDemo(url)
    .then(() =>
      console.log(
        "Demo reproducible lista: demo-a/demo-b, admin/consulta/inactivo; clave ficticia documentada.",
      ),
    )
    .catch(() => {
      console.error(
        "Seed rechazado: exige demo dedicada, migrada y sin cambios manuales.",
      );
      process.exitCode = 1;
    });
}
