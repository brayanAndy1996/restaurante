export type RestaurantMode = "cloud" | "local";

export interface AppConfig {
  mode: RestaurantMode;
  host: "127.0.0.1";
  port: number;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function readConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): AppConfig {
  const mode = env.RESTAURANTE_MODE ?? "cloud";
  if (mode !== "cloud" && mode !== "local") {
    throw new ConfigurationError("RESTAURANTE_MODE solo admite 'cloud' o 'local'.");
  }

  const portValue = env.PORT ?? "3000";
  if (!/^\d+$/.test(portValue)) {
    throw new ConfigurationError("PORT debe ser un entero entre 1 y 65535.");
  }
  const port = Number(portValue);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError("PORT debe ser un entero entre 1 y 65535.");
  }

  return {
    mode,
    host: "127.0.0.1",
    port,
  };
}
