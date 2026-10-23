import { AuthService, Database } from "./auth.js";
import { readConfig, ConfigurationError } from "./config.js";
import { createHttpServer } from "./server.js";

function loadLocalEnvironment(): void {
  try {
    process.loadEnvFile();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return;
    throw new Error("No se pudo leer el archivo .env.", { cause: error });
  }
}

async function start(): Promise<void> {
  loadLocalEnvironment();
  const config = readConfig();
  let auth: AuthService | undefined;
  const origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${config.port}`;
  const parsedOrigin = new URL(origin);
  if (
    parsedOrigin.origin !== origin ||
    (parsedOrigin.protocol !== "https:" &&
      !(
        parsedOrigin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(parsedOrigin.hostname)
      ))
  )
    throw new Error("APP_ORIGIN requires HTTPS except loopback");
  if (config.mode === "cloud" && process.env.DATABASE_URL) {
    if (process.env.MIGRATION_DATABASE_URL)
      throw new Error(
        "Migration credential must not be present in HTTP process",
      );
    auth = new AuthService(
      new Database(process.env.DATABASE_URL),
      process.env.AUTH_HMAC_SECRET ?? "",
    );
    await auth.initialize();
  }
  const server = await createHttpServer(config, { auth, origin });
  server.on("close", () => {
    void auth?.db.close();
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE")
      console.error("El puerto configurado está ocupado.");
    else console.error("No se pudo iniciar el servidor HTTP.");
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => {
    console.log(
      `Restaurante disponible en http://${config.host}:${config.port} (${config.mode}).`,
    );
  });
}

void start().catch((error: unknown) => {
  if (error instanceof ConfigurationError) console.error(error.message);
  else if (
    error instanceof Error &&
    error.message.startsWith("No se encontró la exportación")
  )
    console.error(error.message);
  else console.error("No se pudo iniciar el servidor Restaurante.");
  process.exitCode = 1;
});
