import { readConfig, ConfigurationError } from "./config.js";
import { createHttpServer } from "./server.js";

function loadLocalEnvironment(): void {
  try {
    process.loadEnvFile();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return;
    throw new Error("No se pudo leer el archivo .env.", { cause: error });
  }
}

async function start(): Promise<void> {
  loadLocalEnvironment();
  const config = readConfig();
  const server = await createHttpServer(config);
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") console.error("El puerto configurado está ocupado.");
    else console.error("No se pudo iniciar el servidor HTTP.");
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => {
    console.log(`Restaurante disponible en http://${config.host}:${config.port} (${config.mode}).`);
  });
}

void start().catch((error: unknown) => {
  if (error instanceof ConfigurationError) console.error(error.message);
  else if (error instanceof Error && error.message.startsWith("No se encontró la exportación")) console.error(error.message);
  else console.error("No se pudo iniciar el servidor Restaurante.");
  process.exitCode = 1;
});
