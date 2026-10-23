import { createHash } from "node:crypto";
import { Database, hashPassword } from "../src/auth.js";
import { bootstrap, stableId } from "./bootstrap-tenant.js";
import { assertDedicated } from "./db-migrate.js";
import type { Transaction } from "sequelize";
export const DEMO_PASSWORD = "RestauranteDemo2026!";
export async function fingerprint(db: Database, t: Transaction) {
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
async function operationsFingerprint(db: Database, t: Transaction) {
  const all = [];
  for (const table of [
    "families",
    "products",
    "sectors",
    "dining_tables",
    "attentions",
    "quantity_adjustments",
    "operation_events",
  ])
    all.push([
      table,
      await db.query(
        `SELECT to_jsonb(r) row FROM restaurant.${table} r ORDER BY to_jsonb(r)::text`,
        [],
        t,
      ),
    ]);
  return createHash("sha256").update(JSON.stringify(all)).digest("hex");
}
async function seedOperations(db: Database, t: Transaction) {
  const [snapshot] = await db.query(
    "SELECT value FROM restaurant.metadata WHERE key='demo_operations_fingerprint'",
    [],
    t,
  );
  if (snapshot) {
    if (snapshot.value !== (await operationsFingerprint(db, t)))
      throw new Error("Demo operations manually modified");
    return;
  }
  for (const table of [
    "families",
    "products",
    "sectors",
    "dining_tables",
    "attentions",
    "quantity_adjustments",
    "operation_events",
  ])
    if (
      (await db.query(`SELECT id FROM restaurant.${table} LIMIT 1`, [], t))
        .length
    )
      throw new Error("Empty operation demo required");
  for (const code of ["demo-a", "demo-b"]) {
    const tenant = stableId(`${code}:tenant`);
    const [tenantRow] = await db.query(
      "SELECT id FROM restaurant.tenants WHERE code=$1",
      [code],
      t,
    );
    if (!tenantRow || tenantRow.id !== tenant)
      throw new Error("Recognized demo tenants required");
    const [principal] = await db.query(
      "SELECT id FROM restaurant.sites WHERE tenant_id=$1 AND code='principal'",
      [tenant],
      t,
    );
    const waiter = stableId(`${code}:waiter`),
      role = stableId(`${code}:waiter-role`);
    await db.exec(
      "INSERT INTO restaurant.roles(id,tenant_id,name) VALUES($1,$2,'Mozo demo')",
      [role, tenant],
      t,
    );
    for (const p of ["carta.consultar", "mesas.operar"])
      await db.exec(
        "INSERT INTO restaurant.role_permissions VALUES($1,$2,$3)",
        [tenant, role, p],
        t,
      );
    await db.exec(
      "INSERT INTO restaurant.users(id,tenant_id,username,password_hash) VALUES($1,$2,'mozo',$3)",
      [waiter, tenant, await hashPassword(DEMO_PASSWORD)],
      t,
    );
    await db.exec(
      "INSERT INTO restaurant.user_roles VALUES($1,$2,$3)",
      [tenant, waiter, role],
      t,
    );
    await db.exec(
      "INSERT INTO restaurant.user_sites VALUES($1,$2,$3)",
      [tenant, waiter, principal!.id],
      t,
    );
    const sites = await db.query(
      "SELECT id,code FROM restaurant.sites WHERE tenant_id=$1 ORDER BY code",
      [tenant],
      t,
    );
    for (const site of sites) {
      const family = stableId(`${code}:${site.code}:family`),
        product = stableId(`${code}:${site.code}:product`),
        sector = stableId(`${code}:${site.code}:sector`),
        table = stableId(`${code}:${site.code}:table`);
      await db.exec(
        "INSERT INTO restaurant.families(id,tenant_id,site_id,code,name) VALUES($1,$2,$3,'platos','Platos demo')",
        [family, tenant, site.id],
        t,
      );
      const quantity =
        code === "demo-b" ? 5 : site.code === "principal" ? 12 : 3;
      await db.exec(
        "INSERT INTO restaurant.products(id,tenant_id,site_id,family_id,code,name,price_cents,quantity,available) VALUES($1,$2,$3,$4,'menu','Menú ficticio',$5,$6,true)",
        [
          product,
          tenant,
          site.id,
          family,
          site.code === "principal" ? 1800 : 2000,
          quantity,
        ],
        t,
      );
      await db.exec(
        "INSERT INTO restaurant.sectors(id,tenant_id,site_id,code,name) VALUES($1,$2,$3,'salon','Salón demo')",
        [sector, tenant, site.id],
        t,
      );
      await db.exec(
        "INSERT INTO restaurant.dining_tables(id,tenant_id,site_id,sector_id,code,capacity,x,y) VALUES($1,$2,$3,$4,'m01',4,100,100)",
        [table, tenant, site.id, sector],
        t,
      );
    }
  }
  await db.exec(
    "INSERT INTO restaurant.metadata(key,value) VALUES('demo_operations_fingerprint',$1)",
    [await operationsFingerprint(db, t)],
    t,
  );
  // Extension adds only known new identities; the verified base snapshot now includes them.
  await db.exec(
    "UPDATE restaurant.metadata SET value=$1 WHERE key='demo_fingerprint'",
    [await fingerprint(db, t)],
    t,
  );
}
// Internal transaction boundary is exported for isolated fixture integration tests.
// The CLI entry point always enforces the dedicated loopback demo URL first.
export async function seedDemoData(db: Database, t: Transaction) {
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
    await seedOperations(db, t);
    return;
  }
  if (
    (await db.query("SELECT id FROM restaurant.tenants LIMIT 1", [], t)).length
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
  await seedOperations(db, t);
  await db.exec(
    "INSERT INTO restaurant.metadata(key,value) VALUES('demo_fingerprint',$1)",
    [await fingerprint(db, t)],
    t,
  );
}
export async function seedDemo(url: string) {
  assertDedicated(url, "demo");
  const db = new Database(url);
  try {
    return await db.sql.transaction((t) => seedDemoData(db, t));
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
        "Demo reproducible lista: demo-a/demo-b, admin/consulta/inactivo/mozo; clave ficticia documentada.",
      ),
    )
    .catch(() => {
      console.error(
        "Seed rechazado: exige demo dedicada, migrada y sin cambios manuales.",
      );
      process.exitCode = 1;
    });
}
