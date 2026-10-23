"use client";

import { useCallback, useEffect, useState } from "react";

type Mode = "cloud" | "local";
type CapabilityKey = "authentication" | "persistence" | "businessOperations" | "continuity";
type Health = {
  service: "restaurante";
  status: "ok";
  mode: Mode;
  capabilities: Record<CapabilityKey, boolean>;
};
type ContextError = { error: { code: "AUTH_REQUIRED"; message: string } };

const capabilityLabels: { key: CapabilityKey; label: string }[] = [
  { key: "authentication", label: "Acceso y autenticación" },
  { key: "persistence", label: "Base de datos y persistencia" },
  { key: "businessOperations", label: "Operación comercial" },
  { key: "continuity", label: "Continuidad local" },
];

function isHealth(value: unknown): value is Health {
  if (!value || typeof value !== "object") return false;
  const health = value as Partial<Health>;
  const capabilities = health.capabilities;
  return (
    health.service === "restaurante" &&
    health.status === "ok" &&
    (health.mode === "cloud" || health.mode === "local") &&
    !!capabilities &&
    typeof capabilities.authentication === "boolean" &&
    typeof capabilities.persistence === "boolean" &&
    typeof capabilities.businessOperations === "boolean" &&
    typeof capabilities.continuity === "boolean"
  );
}

function isAuthRequired(value: unknown): value is ContextError {
  if (!value || typeof value !== "object") return false;
  const error = (value as Partial<ContextError>).error;
  return !!error && error.code === "AUTH_REQUIRED" && typeof error.message === "string";
}

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthState, setHealthState] = useState<"loading" | "ready" | "error">("loading");
  const [healthError, setHealthError] = useState("");
  const [contextState, setContextState] = useState<"loading" | "denied" | "error">("loading");

  const checkHealth = useCallback(async () => {
    setHealthState("loading");
    setHealthError("");
    setHealth(null);
    try {
      const response = await fetch("/api/health", { cache: "no-store", headers: { Accept: "application/json" } });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setHealthError("La API no pudo completar el diagnóstico.");
        setHealthState("error");
        return;
      }
      if (!isHealth(payload)) {
        setHealthError("La API respondió con un diagnóstico inválido.");
        setHealthState("error");
        return;
      }
      setHealth(payload);
      setHealthState("ready");
    } catch {
      setHealthError("No se pudo consultar la API. Comprueba el servidor e inténtalo de nuevo.");
      setHealthState("error");
    }
  }, []);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  useEffect(() => {
    let active = true;
    const checkContext = async () => {
      try {
        const response = await fetch("/api/context", { cache: "no-store", headers: { Accept: "application/json" } });
        const payload: unknown = await response.json().catch(() => null);
        if (!active) return;
        if (response.status === 401 && isAuthRequired(payload)) setContextState("denied");
        else setContextState("error");
      } catch {
        if (active) setContextState("error");
      }
    };
    void checkContext();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="page-shell">
      <header className="page-header">
        <p className="eyebrow">Restaurante · base técnica</p>
        <h1>Diagnóstico del servicio</h1>
        <p className="intro">Consulta el estado real de la API y las capacidades disponibles en esta entrega.</p>
      </header>

      <section className="panel" aria-labelledby="api-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Proceso HTTP</p>
            <h2 id="api-title">Disponibilidad de la API</h2>
          </div>
          <button type="button" onClick={() => void checkHealth()} disabled={healthState === "loading"}>
            {healthState === "loading" ? "Consultando…" : "Reintentar diagnóstico"}
          </button>
        </div>

        {healthState === "loading" && <p className="status-line" role="status">Consultando la API…</p>}
        {healthState === "error" && <p className="status-line error" role="alert">{healthError}</p>}
        {healthState === "ready" && health && (
          <div className="diagnostic-result" role="status" aria-live="polite">
            <p className="status-line success">API disponible</p>
            <dl className="details">
              <div><dt>Modo configurado</dt><dd>{health.mode === "cloud" ? "Nube" : "Local"}</dd></div>
              <div><dt>Servicio</dt><dd>{health.service}</dd></div>
              <div><dt>Alcance de estado</dt><dd>El proceso HTTP responde; no confirma conexión a una base de datos.</dd></div>
            </dl>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="capabilities-title">
        <p className="eyebrow">Alcance de esta entrega</p>
        <h2 id="capabilities-title">Capacidades pendientes</h2>
        {healthState === "ready" && health ? (
          <ul className="capability-list">
            {capabilityLabels.map(({ key, label }) => (
              <li key={key}>
                <span>{label}</span>
                <strong className={health.capabilities[key] ? "capability-ready" : "capability-pending"}>
                  {health.capabilities[key] ? "Disponible" : "Pendiente"}
                </strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">El diagnóstico de capacidades aparecerá cuando la API responda.</p>
        )}
      </section>

      <section className="panel" aria-labelledby="context-title">
        <p className="eyebrow">Acceso protegido</p>
        <h2 id="context-title">Contexto de usuario y local</h2>
        {contextState === "loading" && <p className="muted" role="status">Consultando el acceso…</p>}
        {contextState === "denied" && (
          <p className="status-line pending">Acceso pendiente: la API rechazó la consulta porque la autenticación aún no está implementada. No se ha autenticado ningún usuario ni local.</p>
        )}
        {contextState === "error" && (
          <p className="status-line error" role="status">No se pudo confirmar el acceso. Esta entrega no habilita un usuario ni un ámbito de negocio.</p>
        )}
      </section>

      <footer className="page-footer">
        Esta pantalla no habilita ventas, caja, mesas, persistencia ni continuidad sin conexión.
      </footer>
    </main>
  );
}
