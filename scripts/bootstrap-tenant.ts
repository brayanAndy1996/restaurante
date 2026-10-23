import { StringDecoder } from "node:string_decoder";
import type { Transaction } from "sequelize";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Database, hashPassword } from "../src/auth.js";
import { PERMISSIONS, normalizeIdentifier, text } from "../src/auth-policy.js";
export function stableId(value: string) {
  const h = createHash("sha256")
    .update(`restaurant:002:${value}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export interface BootstrapInput {
  code: string;
  name: string;
  siteCode: string;
  siteName: string;
  username: string;
  password: string;
  deterministic?: boolean;
  failAfterUser?: boolean;
}
export async function bootstrap(
  db: Database,
  input: BootstrapInput,
  transaction?: Transaction,
) {
  const code = normalizeIdentifier(input.code),
    username = normalizeIdentifier(input.username),
    siteCode = normalizeIdentifier(input.siteCode);
  const passwordHash = await hashPassword(input.password);
  const id = (part: string) =>
    input.deterministic ? stableId(`${code}:${part}`) : randomUUID();
  const tenantId = id("tenant"),
    siteId = id("site"),
    userId = id("admin"),
    roleId = id("admin-role");
  const run = async (t: Transaction) => {
    await db.query("SELECT pg_advisory_xact_lock(226002)", [], t);
    if (
      (
        await db.query(
          "SELECT id FROM restaurant.tenants WHERE code=$1",
          [code],
          t,
        )
      ).length
    )
      throw new Error("Tenant exists; bootstrap does not reset passwords");
    await db.exec(
      "INSERT INTO restaurant.tenants(id,code,name) VALUES($1,$2,$3)",
      [tenantId, code, text(input.name)],
      t,
    );
    await db.exec(
      "INSERT INTO restaurant.sites(id,tenant_id,code,name) VALUES($1,$2,$3,$4)",
      [siteId, tenantId, siteCode, text(input.siteName)],
      t,
    );
    await db.exec(
      "INSERT INTO restaurant.users(id,tenant_id,username,password_hash) VALUES($1,$2,$3,$4)",
      [userId, tenantId, username, passwordHash],
      t,
    );
    if (input.failAfterUser) throw new Error("Injected bootstrap failure");
    await db.exec(
      "INSERT INTO restaurant.roles(id,tenant_id,name) VALUES($1,$2,'Administrador')",
      [roleId, tenantId],
      t,
    );
    for (const p of PERMISSIONS)
      await db.exec(
        "INSERT INTO restaurant.role_permissions(tenant_id,role_id,permission) VALUES($1,$2,$3)",
        [tenantId, roleId, p],
        t,
      );
    await db.exec(
      "INSERT INTO restaurant.user_roles(tenant_id,user_id,role_id) VALUES($1,$2,$3)",
      [tenantId, userId, roleId],
      t,
    );
    await db.exec(
      "INSERT INTO restaurant.user_sites(tenant_id,user_id,site_id) VALUES($1,$2,$3)",
      [tenantId, userId, siteId],
      t,
    );
    await db.exec(
      "INSERT INTO restaurant.audit_events(id,tenant_id,action,entity_id,outcome) VALUES($1,$2,'tenant.bootstrap',$3,'success')",
      [randomUUID(), tenantId, tenantId],
      t,
    );
    return { tenantId, siteId, userId, roleId };
  };
  return transaction ? run(transaction) : db.sql.transaction(run);
}
async function secret(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error("Interactive TTY required for hidden password");
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const decoder = new StringDecoder("utf8");
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stdout.write("\n");
    };
    const onData = (data: Buffer) => {
      for (const c of decoder.write(data)) {
        if (c === "\r" || c === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (c === "\u0003") {
          finish();
          reject(new Error("Cancelled"));
          return;
        }
        if (c === "\u007f" || c === "\b")
          value = [...value].slice(0, -1).join("");
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}
async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL required");
  const rl = createInterface({ input: stdin, output: stdout });
  const target = new URL(url);
  console.log(
    `Alta explícita en ${target.hostname}:${target.port || 5432}${target.pathname}`,
  );
  const code = await rl.question("Código empresa: "),
    name = await rl.question("Nombre empresa: "),
    siteCode = await rl.question("Código local: "),
    siteName = await rl.question("Nombre local: "),
    username = await rl.question("Usuario administrador: ");
  rl.close();
  const password = await secret("Contraseña (oculta): ");
  const repeat = await secret("Repetir contraseña (oculta): ");
  if (password !== repeat) throw new Error("Passwords differ");
  const db = new Database(url);
  try {
    await bootstrap(db, { code, name, siteCode, siteName, username, password });
    console.log("Empresa creada; ingresa con su administrador.");
  } finally {
    await db.close();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/bootstrap-tenant.ts"))
  main().catch(() => {
    console.error(
      "Alta rechazada; no se sustituyeron credenciales existentes.",
    );
    process.exitCode = 1;
  });
