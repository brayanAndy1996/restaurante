"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ApiError, apiRequest, type AuthContext } from "./api-client";

const PERMISSIONS = {
  consult: "carta.consultar",
  manageMenu: "carta.gestionar",
  adjustStock: "stock.ajustar",
  manageDiningRoom: "salon.gestionar",
  operateTables: "mesas.operar",
} as const;

type Family = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  version: number;
};
type Product = {
  id: string;
  code: string;
  name: string;
  familyId: string;
  priceCents: number;
  active: boolean;
  available: boolean;
  quantity: number;
  effectiveAvailable: boolean;
  version: number;
};
type Sector = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  version: number;
};
type Attention = {
  id: string;
  tableId: string;
  waiterId: string;
  waiterName: string;
  guests: number;
  requestId: string;
  status: "active" | "cancelled";
  openedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
};
type DiningTable = {
  id: string;
  code: string;
  sectorId: string;
  capacity: number;
  x: number | null;
  y: number | null;
  active: boolean;
  version: number;
  state: "free" | "occupied";
  attention: Attention | null;
};
type Waiter = { id: string; username: string };
type ListResponse<T> = { items: T[] };
type LoadKey = "families" | "products" | "sectors" | "tables" | "waiters";
type LoadState = Record<LoadKey, boolean>;
type LoadErrors = Partial<Record<LoadKey, string>>;
type OpenPayload = { tableId: string; waiterId: string; guests: number };
type PendingOpen = OpenPayload & { requestId: string };

const EMPTY_LOADING: LoadState = {
  families: false,
  products: false,
  sectors: false,
  tables: false,
  waiters: false,
};

function codeValue(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(normalized) ? normalized : null;
}

function parsePriceCents(value: string): number | null {
  const normalized = value.trim();
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) && cents <= 100_000_000 ? cents : null;
}

function formatPriceCents(cents: number): string {
  const whole = Math.floor(cents / 100).toLocaleString("es-PE");
  const fraction = String(cents % 100).padStart(2, "0");
  return `S/ ${whole}.${fraction}`;
}

function priceInputValue(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function integerValue(value: string, min: number, max: number): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

function optionalCoordinate(value: string): number | null | undefined {
  const normalized = value.trim();
  if (!normalized) return null;
  return integerValue(normalized, 0, 10_000) ?? undefined;
}

function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

function checked(data: FormData, name: string): boolean {
  return data.get(name) === "on";
}

function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status === 401) return "La sesión venció. Vuelve a ingresar.";
  if (error.status === 403 || error.code === "FORBIDDEN")
    return "No tienes permiso para consultar o modificar este módulo.";
  if (error.status === 404 || error.code === "NOT_FOUND")
    return "El local o registro ya no está disponible. Actualiza la información.";
  if (error.status === 409 || error.code === "CONFLICT")
    return "El registro cambió o está ocupado. Actualiza la información y vuelve a intentarlo.";
  if (error.code === "VALIDATION_ERROR")
    return "El servidor rechazó los datos. Revisa los campos e inténtalo de nuevo.";
  if (error.status >= 500)
    return "El servidor no pudo confirmar la solicitud. Puedes volver a intentarlo.";
  return fallback;
}

function sitePath(siteId: string, path: string): string {
  return `/api/operations/sites/${encodeURIComponent(siteId)}${path}`;
}

function abortControllers(controllers: Set<AbortController>): void {
  for (const controller of controllers) controller.abort();
  controllers.clear();
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Lima",
  }).format(date);
}

export default function Operations({
  context,
  onSessionExpired,
  isLoggingOut,
}: {
  context: AuthContext;
  onSessionExpired: () => void;
  isLoggingOut: boolean;
}) {
  const permissions = useMemo(
    () => new Set(context.permissions),
    [context.permissions],
  );
  const activeSites = useMemo(
    () => context.sites.filter((site) => site.active),
    [context.sites],
  );
  const canConsultMenu = permissions.has(PERMISSIONS.consult);
  const canManageMenu = permissions.has(PERMISSIONS.manageMenu);
  const canAdjustStock = permissions.has(PERMISSIONS.adjustStock);
  const canManageDiningRoom = permissions.has(PERMISSIONS.manageDiningRoom);
  const canOperateTables = permissions.has(PERMISSIONS.operateTables);
  const canLoadDiningRoom =
    canConsultMenu || canManageDiningRoom || canOperateTables;
  const showMenuModule = canConsultMenu || canManageMenu || canAdjustStock;
  const showDiningRoomModule = canLoadDiningRoom;

  const [siteId, setSiteId] = useState("");
  const selectedSiteRef = useRef("");
  const [families, setFamilies] = useState<Family[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [loading, setLoading] = useState<LoadState>(EMPTY_LOADING);
  const [loadErrors, setLoadErrors] = useState<LoadErrors>({});
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [openTableId, setOpenTableId] = useState("");
  const [openWaiterId, setOpenWaiterId] = useState("");
  const [openGuests, setOpenGuests] = useState("1");
  const [pendingOpens, setPendingOpens] = useState<PendingOpen[]>([]);
  const pendingOpenMap = useRef(new Map<string, PendingOpen>());
  const requestControllers = useRef(new Set<AbortController>());
  const sessionExpiredRef = useRef(onSessionExpired);
  sessionExpiredRef.current = onSessionExpired;

  useEffect(() => () => abortControllers(requestControllers.current), []);

  useEffect(() => {
    if (!isLoggingOut) return;
    selectedSiteRef.current = "";
    abortControllers(requestControllers.current);
    setSiteId("");
    setFamilies([]);
    setProducts([]);
    setSectors([]);
    setTables([]);
    setWaiters([]);
    setLoading(EMPTY_LOADING);
    setLoadErrors({});
    setPendingAction(null);
    setActionError("");
    setActionMessage("");
    setOpenTableId("");
    setOpenWaiterId("");
    setOpenGuests("1");
    pendingOpenMap.current.clear();
    setPendingOpens([]);
  }, [isLoggingOut]);

  useEffect(() => {
    if (!siteId) return;

    const requestedSiteId = siteId;
    const controller = new AbortController();
    requestControllers.current.add(controller);
    let expired = false;
    const requested: Partial<LoadState> = {};
    if (canConsultMenu) {
      requested.families = true;
      requested.products = true;
    }
    if (canLoadDiningRoom) {
      requested.sectors = true;
      requested.tables = true;
    }
    if (canOperateTables) requested.waiters = true;
    setLoading({ ...EMPTY_LOADING, ...requested });
    setLoadErrors({});

    const isCurrent = () =>
      !controller.signal.aborted && selectedSiteRef.current === requestedSiteId;
    const load = async <T,>(
      key: LoadKey,
      path: string,
      apply: (items: T[]) => void,
    ) => {
      try {
        const response = await apiRequest<ListResponse<T>>(
          sitePath(requestedSiteId, path),
          { signal: controller.signal },
        );
        if (isCurrent()) apply(response.items);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          if (!expired) {
            expired = true;
            sessionExpiredRef.current();
          }
        } else if (isCurrent()) {
          setLoadErrors((previous) => ({
            ...previous,
            [key]: errorMessage(
              error,
              "No se pudo cargar esta lista. Reintenta.",
            ),
          }));
        }
      } finally {
        if (isCurrent())
          setLoading((previous) => ({ ...previous, [key]: false }));
      }
    };

    const jobs: Promise<void>[] = [];
    if (canConsultMenu) {
      jobs.push(load("families", "/families", setFamilies));
      jobs.push(load("products", "/products", setProducts));
    }
    if (canLoadDiningRoom) {
      jobs.push(load("sectors", "/sectors", setSectors));
      jobs.push(load("tables", "/tables", setTables));
    }
    if (canOperateTables) jobs.push(load("waiters", "/waiters", setWaiters));
    void Promise.all(jobs);

    return () => {
      controller.abort();
      requestControllers.current.delete(controller);
    };
  }, [
    siteId,
    canConsultMenu,
    canLoadDiningRoom,
    canOperateTables,
    refreshVersion,
  ]);

  const onSelectSite = (nextSiteId: string) => {
    if (nextSiteId && !activeSites.some((site) => site.id === nextSiteId)) {
      setActionError("Ese local no está asignado a tu cuenta para operar.");
      return;
    }
    selectedSiteRef.current = nextSiteId;
    abortControllers(requestControllers.current);
    setSiteId(nextSiteId);
    setFamilies([]);
    setProducts([]);
    setSectors([]);
    setTables([]);
    setWaiters([]);
    setLoading(EMPTY_LOADING);
    setLoadErrors({});
    setPendingAction(null);
    setActionError("");
    setActionMessage("");
    setOpenTableId("");
    setOpenWaiterId("");
    setOpenGuests("1");
    pendingOpenMap.current.clear();
    setPendingOpens([]);
  };

  useEffect(() => {
    if (siteId && !activeSites.some((site) => site.id === siteId)) {
      selectedSiteRef.current = "";
      abortControllers(requestControllers.current);
      setSiteId("");
      setFamilies([]);
      setProducts([]);
      setSectors([]);
      setTables([]);
      setWaiters([]);
      setLoading(EMPTY_LOADING);
      setLoadErrors({});
      setPendingAction(null);
      setActionError("");
      setActionMessage("");
      setOpenTableId("");
      setOpenWaiterId("");
      setOpenGuests("1");
      pendingOpenMap.current.clear();
      setPendingOpens([]);
    }
  }, [activeSites, siteId]);

  const runMutation = async <T,>(
    key: string,
    path: string,
    method: "POST" | "PATCH",
    body: unknown,
    successMessage: string,
    onDefinitiveFailure?: () => void,
  ): Promise<T | null> => {
    const requestedSiteId = selectedSiteRef.current;
    if (!requestedSiteId) return null;
    const controller = new AbortController();
    requestControllers.current.add(controller);
    setPendingAction(key);
    setActionError("");
    setActionMessage("");
    try {
      const response = await apiRequest<T>(sitePath(requestedSiteId, path), {
        method,
        body,
        csrfToken: context.csrfToken,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        selectedSiteRef.current !== requestedSiteId
      )
        return null;
      setActionMessage(successMessage);
      setRefreshVersion((version) => version + 1);
      return response;
    } catch (error) {
      if (
        controller.signal.aborted ||
        selectedSiteRef.current !== requestedSiteId
      )
        return null;
      if (error instanceof ApiError && error.status === 401) {
        sessionExpiredRef.current();
      } else {
        setActionError(
          errorMessage(
            error,
            "No se pudo conectar con el servidor. Revisa la conexión e inténtalo de nuevo.",
          ),
        );
        if (error instanceof ApiError && error.status < 500)
          onDefinitiveFailure?.();
        if (error instanceof ApiError && error.status === 409)
          setRefreshVersion((version) => version + 1);
      }
      return null;
    } finally {
      requestControllers.current.delete(controller);
      if (selectedSiteRef.current === requestedSiteId)
        setPendingAction((current) => (current === key ? null : current));
    }
  };

  const onCreateFamily = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const code = codeValue(field(data, "code"));
    const name = field(data, "name").trim();
    if (!code || !name || name.length > 80) {
      setActionError(
        "Ingresa un código ASCII válido y un nombre de 1 a 80 caracteres.",
      );
      return;
    }
    const created = await runMutation<Family>(
      "create-family",
      "/families",
      "POST",
      { code, name },
      "Familia creada.",
    );
    if (created) form.reset();
  };

  const onSaveFamily = async (
    event: FormEvent<HTMLFormElement>,
    family: Family,
  ) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const code = codeValue(field(data, "code"));
    const name = field(data, "name").trim();
    if (!code || !name || name.length > 80) {
      setActionError(
        "Ingresa un código ASCII válido y un nombre de 1 a 80 caracteres.",
      );
      return;
    }
    await runMutation<Family>(
      `family-${family.id}`,
      `/families/${encodeURIComponent(family.id)}`,
      "PATCH",
      {
        version: family.version,
        code,
        name,
        active: checked(data, "active"),
      },
      "Familia actualizada.",
    );
  };

  const onCreateProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const code = codeValue(field(data, "code"));
    const name = field(data, "name").trim();
    const familyId = field(data, "familyId");
    const priceCents = parsePriceCents(field(data, "price"));
    if (
      !code ||
      !name ||
      name.length > 80 ||
      !familyId ||
      priceCents === null
    ) {
      setActionError(
        "Revisa el código, nombre, familia y precio. Usa un precio decimal con hasta dos cifras.",
      );
      return;
    }
    const created = await runMutation<Product>(
      "create-product",
      "/products",
      "POST",
      { code, name, familyId, priceCents },
      "Producto creado.",
    );
    if (created) form.reset();
  };

  const onSaveProduct = async (
    event: FormEvent<HTMLFormElement>,
    product: Product,
  ) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const code = codeValue(field(data, "code"));
    const name = field(data, "name").trim();
    const familyId = field(data, "familyId");
    const priceCents = parsePriceCents(field(data, "price"));
    if (
      !code ||
      !name ||
      name.length > 80 ||
      !familyId ||
      priceCents === null
    ) {
      setActionError(
        "Revisa el código, nombre, familia y precio. Usa un precio decimal con hasta dos cifras.",
      );
      return;
    }
    await runMutation<Product>(
      `product-${product.id}`,
      `/products/${encodeURIComponent(product.id)}`,
      "PATCH",
      {
        version: product.version,
        code,
        name,
        familyId,
        priceCents,
        active: checked(data, "active"),
        available: checked(data, "available"),
      },
      "Producto actualizado.",
    );
  };

  const onAdjustQuantity = async (
    event: FormEvent<HTMLFormElement>,
    product: Product,
  ) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const quantity = integerValue(field(data, "quantity"), 0, 1_000_000);
    const reason = field(data, "reason").trim();
    if (quantity === null || !reason) {
      setActionError(
        "Ingresa una cantidad entera entre 0 y 1 000 000 y un motivo obligatorio.",
      );
      return;
    }
    await runMutation<Product>(
      `quantity-${product.id}`,
      `/products/${encodeURIComponent(product.id)}/quantity`,
      "POST",
      {
        version: product.version,
        quantity,
        reason,
      },
      "Cantidad actualizada.",
    );
  };

  const onCreateSector = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const code = codeValue(field(data, "code"));
    const name = field(data, "name").trim();
    if (!code || !name || name.length > 80) {
      setActionError(
        "Ingresa un código ASCII válido y un nombre de 1 a 80 caracteres.",
      );
      return;
    }
    const created = await runMutation<Sector>(
      "create-sector",
      "/sectors",
      "POST",
      { code, name },
      "Sector creado.",
    );
    if (created) form.reset();
  };

  const onSaveSector = async (
    event: FormEvent<HTMLFormElement>,
    sector: Sector,
    hasActiveAttention: boolean,
  ) => {
    event.preventDefault();
    if (hasActiveAttention) return;
    const data = new FormData(event.currentTarget);
    const code = codeValue(field(data, "code"));
    const name = field(data, "name").trim();
    if (!code || !name || name.length > 80) {
      setActionError(
        "Ingresa un código ASCII válido y un nombre de 1 a 80 caracteres.",
      );
      return;
    }
    await runMutation<Sector>(
      `sector-${sector.id}`,
      `/sectors/${encodeURIComponent(sector.id)}`,
      "PATCH",
      {
        version: sector.version,
        code,
        name,
        active: checked(data, "active"),
      },
      "Sector actualizado.",
    );
  };

  const onCreateTable = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const code = codeValue(field(data, "code"));
    const sectorId = field(data, "sectorId");
    const capacity = integerValue(field(data, "capacity"), 1, 100);
    const x = optionalCoordinate(field(data, "x"));
    const y = optionalCoordinate(field(data, "y"));
    if (
      !code ||
      !sectorId ||
      capacity === null ||
      x === undefined ||
      y === undefined
    ) {
      setActionError(
        "Revisa el código, sector, capacidad y coordenadas enteras entre 0 y 10 000.",
      );
      return;
    }
    const body: Record<string, unknown> = { code, sectorId, capacity };
    if (x !== null) body.x = x;
    if (y !== null) body.y = y;
    const created = await runMutation<DiningTable>(
      "create-table",
      "/tables",
      "POST",
      body,
      "Mesa creada.",
    );
    if (created) form.reset();
  };

  const onSaveTable = async (
    event: FormEvent<HTMLFormElement>,
    table: DiningTable,
  ) => {
    event.preventDefault();
    if (table.state === "occupied") return;
    const data = new FormData(event.currentTarget);
    const code = codeValue(field(data, "code"));
    const sectorId = field(data, "sectorId");
    const capacity = integerValue(field(data, "capacity"), 1, 100);
    const x = optionalCoordinate(field(data, "x"));
    const y = optionalCoordinate(field(data, "y"));
    if (
      !code ||
      !sectorId ||
      capacity === null ||
      x === undefined ||
      y === undefined
    ) {
      setActionError(
        "Revisa el código, sector, capacidad y coordenadas enteras entre 0 y 10 000.",
      );
      return;
    }
    await runMutation<DiningTable>(
      `table-${table.id}`,
      `/tables/${encodeURIComponent(table.id)}`,
      "PATCH",
      {
        version: table.version,
        code,
        sectorId,
        capacity,
        x,
        y,
        active: checked(data, "active"),
      },
      "Mesa actualizada.",
    );
  };

  const openPayloadKey = (payload: OpenPayload) =>
    JSON.stringify([payload.tableId, payload.waiterId, payload.guests]);
  const onOpenAttention = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: OpenPayload = {
      tableId: openTableId,
      waiterId: openWaiterId,
      guests: integerValue(openGuests, 1, 100) ?? 0,
    };
    const table = tables.find((item) => item.id === payload.tableId);
    if (
      !table ||
      !payload.waiterId ||
      payload.guests < 1 ||
      payload.guests > table.capacity ||
      !table.active ||
      table.state !== "free"
    ) {
      setActionError(
        "Selecciona una mesa libre y activa, un mozo habilitado y una cantidad de comensales dentro de la capacidad.",
      );
      return;
    }

    const key = openPayloadKey(payload);
    let pending = pendingOpenMap.current.get(key);
    if (!pending) {
      if (typeof crypto.randomUUID !== "function") {
        setActionError(
          "Este navegador no puede generar una solicitud segura de apertura.",
        );
        return;
      }
      pending = { ...payload, requestId: crypto.randomUUID() };
      pendingOpenMap.current.set(key, pending);
      setPendingOpens([...pendingOpenMap.current.values()]);
    }
    const result = await runMutation<Attention>(
      "open-attention",
      "/attentions",
      "POST",
      {
        requestId: pending.requestId,
        tableId: pending.tableId,
        waiterId: pending.waiterId,
        guests: pending.guests,
      },
      "Atención abierta.",
      () => {
        pendingOpenMap.current.delete(key);
        setPendingOpens([...pendingOpenMap.current.values()]);
      },
    );
    if (result) {
      pendingOpenMap.current.delete(key);
      setPendingOpens([...pendingOpenMap.current.values()]);
      setOpenTableId("");
      setOpenGuests("1");
    }
  };

  const restorePendingOpen = (pending: PendingOpen) => {
    setOpenTableId(pending.tableId);
    setOpenWaiterId(pending.waiterId);
    setOpenGuests(String(pending.guests));
    setActionMessage(
      "La próxima reintentona usará el mismo identificador de solicitud.",
    );
    setActionError("");
  };

  const onCancelAttention = async (
    event: FormEvent<HTMLFormElement>,
    table: DiningTable,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const attention = table.attention;
    if (!attention || attention.status !== "active") return;
    const data = new FormData(form);
    const reason = field(data, "reason").trim();
    if (!reason) {
      setActionError("Escribe el motivo para cancelar la atención vacía.");
      return;
    }
    const cancelled = await runMutation<Attention>(
      `cancel-attention-${attention.id}`,
      `/attentions/${encodeURIComponent(attention.id)}/cancel`,
      "POST",
      { reason },
      "Atención cancelada; la mesa quedó libre.",
    );
    if (cancelled) form.reset();
  };

  const busy = pendingAction !== null;
  const canCreateProduct = canManageMenu && canConsultMenu;
  const freeActiveTables = tables.filter((table) => {
    const sector = sectors.find((item) => item.id === table.sectorId);
    return table.active && table.state === "free" && sector?.active;
  });
  const selectedOpenTable = freeActiveTables.find(
    (table) => table.id === openTableId,
  );
  const currentOpenPayloadKey = openPayloadKey({
    tableId: openTableId,
    waiterId: openWaiterId,
    guests: integerValue(openGuests, 1, 100) ?? 0,
  });
  const currentOpenIsPending = pendingOpens.some(
    (pending) => openPayloadKey(pending) === currentOpenPayloadKey,
  );

  if (isLoggingOut) return null;

  return (
    <section className="panel" aria-labelledby="operations-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Operación por local</p>
          <h2 id="operations-title">Carta y salón</h2>
        </div>
        <button
          type="button"
          onClick={() => setRefreshVersion((version) => version + 1)}
          disabled={!siteId || Object.values(loading).some(Boolean)}
        >
          {Object.values(loading).some(Boolean) ? "Cargando…" : "Actualizar"}
        </button>
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="operations-site">Local</label>
          <select
            id="operations-site"
            value={siteId}
            onChange={(event) => onSelectSite(event.currentTarget.value)}
          >
            <option value="">Selecciona un local</option>
            {activeSites.map((site) => (
              <option value={site.id} key={site.id}>
                {site.name} ({site.code})
              </option>
            ))}
          </select>
        </div>
        {!activeSites.length && (
          <p className="muted">
            No tienes locales activos asignados para operar.
          </p>
        )}
      </div>

      {!siteId && activeSites.length > 0 && (
        <p className="status-line muted" role="status">
          Elige explícitamente el local cuyas listas y operaciones quieres
          consultar.
        </p>
      )}
      {!siteId && !activeSites.length && (
        <p className="status-line muted" role="status">
          Solicita una asignación a un local activo para continuar.
        </p>
      )}
      {siteId && actionError && (
        <p className="status-line error" role="alert">
          {actionError}
        </p>
      )}
      {siteId && actionMessage && (
        <p className="status-line success" role="status">
          {actionMessage}
        </p>
      )}

      {siteId && pendingOpens.length > 0 && (
        <div
          className="subsection"
          aria-label="Solicitudes de apertura pendientes"
        >
          <h3>Solicitudes de apertura sin confirmación</h3>
          <p className="muted">
            Reintentar la misma apertura conserva su identificador. Si cambias
            los datos, se creará una solicitud distinta.
          </p>
          <ul className="record-list">
            {pendingOpens.map((pending) => (
              <li className="item-card" key={pending.requestId}>
                <p className="compact">
                  Mesa{" "}
                  {tables.find((table) => table.id === pending.tableId)?.code ??
                    "seleccionada"}{" "}
                  · {pending.guests} comensales · solicitud {pending.requestId}
                </p>
                <button
                  type="button"
                  onClick={() => restorePendingOpen(pending)}
                  disabled={busy}
                >
                  Restaurar datos para reintentar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {siteId && showMenuModule && (
        <section className="subsection" aria-labelledby="menu-title">
          <p className="eyebrow">Catálogo</p>
          <h3 id="menu-title">Familias y productos</h3>
          {!canConsultMenu && (
            <p className="muted">
              Necesitas carta.consultar para ver y editar registros existentes.
              Las familias se pueden crear con carta.gestionar.
            </p>
          )}
          {loadErrors.families && (
            <p className="status-line error" role="alert">
              Familias: {loadErrors.families}
            </p>
          )}
          {loadErrors.products && (
            <p className="status-line error" role="alert">
              Productos: {loadErrors.products}
            </p>
          )}
          {loading.families && (
            <p className="muted" role="status">
              Cargando familias…
            </p>
          )}

          {canConsultMenu && (
            <div className="record-list">
              {families.map((family) => (
                <article
                  className="item-card"
                  key={`${family.id}:${family.version}`}
                >
                  <h4>
                    {family.name} <span className="muted">({family.code})</span>
                  </h4>
                  <p className="muted compact">
                    {family.active ? "Activa" : "Inactiva"} · versión{" "}
                    {family.version}
                  </p>
                  {canManageMenu && (
                    <form
                      className="form-grid nested-form"
                      onSubmit={(event) => void onSaveFamily(event, family)}
                    >
                      <div className="field">
                        <label htmlFor={`family-code-${family.id}`}>
                          Código
                        </label>
                        <input
                          id={`family-code-${family.id}`}
                          name="code"
                          defaultValue={family.code}
                          maxLength={32}
                          required
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`family-name-${family.id}`}>
                          Nombre
                        </label>
                        <input
                          id={`family-name-${family.id}`}
                          name="name"
                          defaultValue={family.name}
                          maxLength={80}
                          required
                        />
                      </div>
                      <label className="check-row">
                        <input
                          type="checkbox"
                          name="active"
                          defaultChecked={family.active}
                        />{" "}
                        Activa
                      </label>
                      <div className="form-actions">
                        <button type="submit" disabled={busy}>
                          {busy ? "Guardando…" : "Guardar familia"}
                        </button>
                      </div>
                    </form>
                  )}
                </article>
              ))}
              {!families.length &&
                !loading.families &&
                !loadErrors.families && (
                  <p className="muted">No hay familias para mostrar.</p>
                )}
            </div>
          )}

          {canManageMenu && (
            <div className="subsection">
              <h4>Crear familia</h4>
              <form
                className="form-grid"
                onSubmit={(event) => void onCreateFamily(event)}
              >
                <div className="field">
                  <label htmlFor="new-family-code">Código</label>
                  <input
                    id="new-family-code"
                    name="code"
                    maxLength={32}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="new-family-name">Nombre</label>
                  <input
                    id="new-family-name"
                    name="name"
                    maxLength={80}
                    required
                  />
                </div>
                <div className="form-actions">
                  <button type="submit" disabled={busy}>
                    {busy ? "Guardando…" : "Crear familia"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {loading.products && (
            <p className="muted" role="status">
              Cargando productos…
            </p>
          )}
          {canConsultMenu && (
            <div className="record-list">
              {products.map((product) => {
                const family = families.find(
                  (item) => item.id === product.familyId,
                );
                return (
                  <article
                    className="item-card"
                    key={`${product.id}:${product.version}`}
                  >
                    <h4>
                      {product.name}{" "}
                      <span className="muted">({product.code})</span>
                    </h4>
                    <dl className="details compact-details">
                      <div>
                        <dt>Familia</dt>
                        <dd>{family?.name ?? "No disponible"}</dd>
                      </div>
                      <div>
                        <dt>Precio</dt>
                        <dd>{formatPriceCents(product.priceCents)}</dd>
                      </div>
                      <div>
                        <dt>Cantidad</dt>
                        <dd>{product.quantity}</dd>
                      </div>
                      <div>
                        <dt>Estado efectivo</dt>
                        <dd>
                          {product.effectiveAvailable
                            ? "Disponible"
                            : "No disponible"}
                        </dd>
                      </div>
                      <div>
                        <dt>Control manual</dt>
                        <dd>
                          {product.active ? "Activo" : "Inactivo"} ·{" "}
                          {product.available ? "Disponible" : "No disponible"}
                        </dd>
                      </div>
                    </dl>
                    {canManageMenu && (
                      <form
                        className="form-grid nested-form"
                        onSubmit={(event) => void onSaveProduct(event, product)}
                      >
                        <div className="field">
                          <label htmlFor={`product-code-${product.id}`}>
                            Código
                          </label>
                          <input
                            id={`product-code-${product.id}`}
                            name="code"
                            defaultValue={product.code}
                            maxLength={32}
                            required
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`product-name-${product.id}`}>
                            Nombre
                          </label>
                          <input
                            id={`product-name-${product.id}`}
                            name="name"
                            defaultValue={product.name}
                            maxLength={80}
                            required
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`product-family-${product.id}`}>
                            Familia
                          </label>
                          <select
                            id={`product-family-${product.id}`}
                            name="familyId"
                            defaultValue={product.familyId}
                            required
                          >
                            {families.map((item) => (
                              <option value={item.id} key={item.id}>
                                {item.name}
                                {item.active ? "" : " (inactiva)"}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`product-price-${product.id}`}>
                            Precio (S/)
                          </label>
                          <input
                            id={`product-price-${product.id}`}
                            name="price"
                            inputMode="decimal"
                            defaultValue={priceInputValue(product.priceCents)}
                            required
                          />
                          <span className="field-hint">
                            Hasta dos decimales, por ejemplo 12.50.
                          </span>
                        </div>
                        <label className="check-row">
                          <input
                            type="checkbox"
                            name="active"
                            defaultChecked={product.active}
                          />{" "}
                          Activo
                        </label>
                        <label className="check-row">
                          <input
                            type="checkbox"
                            name="available"
                            defaultChecked={product.available}
                          />{" "}
                          Disponible manualmente
                        </label>
                        <div className="form-actions">
                          <button type="submit" disabled={busy}>
                            {busy ? "Guardando…" : "Guardar producto"}
                          </button>
                        </div>
                      </form>
                    )}
                    {canAdjustStock && (
                      <form
                        className="form-grid nested-form"
                        onSubmit={(event) =>
                          void onAdjustQuantity(event, product)
                        }
                      >
                        <div className="field">
                          <label htmlFor={`quantity-${product.id}`}>
                            Nueva cantidad entera
                          </label>
                          <input
                            id={`quantity-${product.id}`}
                            name="quantity"
                            type="number"
                            min="0"
                            max="1000000"
                            step="1"
                            defaultValue={product.quantity}
                            required
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`quantity-reason-${product.id}`}>
                            Motivo del ajuste
                          </label>
                          <input
                            id={`quantity-reason-${product.id}`}
                            name="reason"
                            required
                          />
                        </div>
                        <div className="form-actions">
                          <button type="submit" disabled={busy}>
                            {busy ? "Guardando…" : "Ajustar cantidad"}
                          </button>
                        </div>
                      </form>
                    )}
                  </article>
                );
              })}
              {!products.length &&
                !loading.products &&
                !loadErrors.products && (
                  <p className="muted">No hay productos para mostrar.</p>
                )}
            </div>
          )}

          {canManageMenu && (
            <div className="subsection">
              <h4>Crear producto</h4>
              {!canCreateProduct ? (
                <p className="muted">
                  Para elegir una familia y crear productos también necesitas
                  carta.consultar.
                </p>
              ) : (
                <form
                  className="form-grid"
                  onSubmit={(event) => void onCreateProduct(event)}
                >
                  <div className="field">
                    <label htmlFor="new-product-code">Código</label>
                    <input
                      id="new-product-code"
                      name="code"
                      maxLength={32}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="new-product-name">Nombre</label>
                    <input
                      id="new-product-name"
                      name="name"
                      maxLength={80}
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="new-product-family">Familia</label>
                    <select
                      id="new-product-family"
                      name="familyId"
                      defaultValue=""
                      required
                    >
                      <option value="" disabled>
                        Selecciona una familia activa
                      </option>
                      {families
                        .filter((family) => family.active)
                        .map((family) => (
                          <option value={family.id} key={family.id}>
                            {family.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="new-product-price">Precio (S/)</label>
                    <input
                      id="new-product-price"
                      name="price"
                      inputMode="decimal"
                      placeholder="12.50"
                      required
                    />
                    <span className="field-hint">
                      Hasta dos decimales; máximo S/ 1 000 000.00.
                    </span>
                  </div>
                  <div className="form-actions">
                    <button
                      type="submit"
                      disabled={
                        busy || families.every((family) => !family.active)
                      }
                    >
                      {busy ? "Guardando…" : "Crear producto"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
          {canAdjustStock && !canConsultMenu && (
            <p className="muted">
              Para seleccionar productos, también necesitas carta.consultar.
            </p>
          )}
        </section>
      )}

      {siteId && showDiningRoomModule && (
        <section className="subsection" aria-labelledby="dining-title">
          <p className="eyebrow">Salón</p>
          <h3 id="dining-title">Sectores, mesas y atención</h3>
          {loadErrors.sectors && (
            <p className="status-line error" role="alert">
              Sectores: {loadErrors.sectors}
            </p>
          )}
          {loadErrors.tables && (
            <p className="status-line error" role="alert">
              Mesas: {loadErrors.tables}
            </p>
          )}
          {loadErrors.waiters && (
            <p className="status-line error" role="alert">
              Mozos: {loadErrors.waiters}
            </p>
          )}
          {(loading.sectors || loading.tables) && (
            <p className="muted" role="status">
              Cargando salón…
            </p>
          )}

          {canOperateTables && (
            <div className="subsection">
              <h4>Abrir atención vacía</h4>
              {!loading.waiters &&
                !loadErrors.waiters &&
                waiters.length === 0 && (
                  <p className="muted">
                    No hay mozos activos con permiso de operación en este local.
                  </p>
                )}
              <form
                className="form-grid"
                onSubmit={(event) => void onOpenAttention(event)}
              >
                <div className="field">
                  <label htmlFor="open-table">Mesa libre</label>
                  <select
                    id="open-table"
                    value={openTableId}
                    onChange={(event) => {
                      setOpenTableId(event.currentTarget.value);
                      setOpenGuests("1");
                    }}
                    required
                  >
                    <option value="">Selecciona una mesa</option>
                    {freeActiveTables.map((table) => (
                      <option value={table.id} key={table.id}>
                        {sectors.find((sector) => sector.id === table.sectorId)
                          ?.name ?? "Sector"}{" "}
                        · {table.code} · capacidad {table.capacity}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="open-waiter">Mozo responsable</label>
                  <select
                    id="open-waiter"
                    value={openWaiterId}
                    onChange={(event) =>
                      setOpenWaiterId(event.currentTarget.value)
                    }
                    required
                  >
                    <option value="">Selecciona un mozo</option>
                    {waiters.map((waiter) => (
                      <option value={waiter.id} key={waiter.id}>
                        {waiter.username}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="open-guests">Comensales</label>
                  <input
                    id="open-guests"
                    type="number"
                    min="1"
                    max={selectedOpenTable?.capacity ?? 100}
                    step="1"
                    value={openGuests}
                    onChange={(event) =>
                      setOpenGuests(event.currentTarget.value)
                    }
                    required
                  />
                  <span className="field-hint">
                    Máximo{" "}
                    {selectedOpenTable?.capacity ?? "según capacidad de mesa"}.
                  </span>
                </div>
                <div className="form-actions">
                  <button
                    type="submit"
                    disabled={
                      busy ||
                      !siteId ||
                      loading.waiters ||
                      !waiters.length ||
                      !freeActiveTables.length
                    }
                  >
                    {pendingAction === "open-attention"
                      ? "Enviando…"
                      : currentOpenIsPending
                        ? "Reintentar apertura"
                        : "Abrir atención"}
                  </button>
                </div>
              </form>
              {pendingOpens.some(
                (pending) =>
                  openPayloadKey(pending) ===
                  openPayloadKey({
                    tableId: openTableId,
                    waiterId: openWaiterId,
                    guests: integerValue(openGuests, 1, 100) ?? 0,
                  }),
              ) && (
                <p className="field-hint">
                  Esta apertura ya tiene una solicitud pendiente; reintentar
                  conserva el mismo UUID.
                </p>
              )}
            </div>
          )}

          {canManageDiningRoom && (
            <div className="subsection">
              <h4>Crear sector</h4>
              <form
                className="form-grid"
                onSubmit={(event) => void onCreateSector(event)}
              >
                <div className="field">
                  <label htmlFor="new-sector-code">Código</label>
                  <input
                    id="new-sector-code"
                    name="code"
                    maxLength={32}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="new-sector-name">Nombre</label>
                  <input
                    id="new-sector-name"
                    name="name"
                    maxLength={80}
                    required
                  />
                </div>
                <div className="form-actions">
                  <button type="submit" disabled={busy}>
                    {busy ? "Guardando…" : "Crear sector"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {canManageDiningRoom && (
            <div className="subsection">
              <h4>Crear mesa</h4>
              {sectors.filter((sector) => sector.active).length === 0 && (
                <p className="muted">
                  Crea un sector activo para poder registrar mesas.
                </p>
              )}
              <form
                className="form-grid"
                onSubmit={(event) => void onCreateTable(event)}
              >
                <div className="field">
                  <label htmlFor="new-table-code">Código</label>
                  <input
                    id="new-table-code"
                    name="code"
                    maxLength={32}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="new-table-sector">Sector</label>
                  <select
                    id="new-table-sector"
                    name="sectorId"
                    defaultValue=""
                    required
                  >
                    <option value="" disabled>
                      Selecciona un sector
                    </option>
                    {sectors
                      .filter((sector) => sector.active)
                      .map((sector) => (
                        <option value={sector.id} key={sector.id}>
                          {sector.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="new-table-capacity">Capacidad</label>
                  <input
                    id="new-table-capacity"
                    name="capacity"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    defaultValue="2"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="new-table-x">Coordenada X (opcional)</label>
                  <input
                    id="new-table-x"
                    name="x"
                    type="number"
                    min="0"
                    max="10000"
                    step="1"
                  />
                </div>
                <div className="field">
                  <label htmlFor="new-table-y">Coordenada Y (opcional)</label>
                  <input
                    id="new-table-y"
                    name="y"
                    type="number"
                    min="0"
                    max="10000"
                    step="1"
                  />
                </div>
                <div className="form-actions">
                  <button
                    type="submit"
                    disabled={busy || sectors.every((sector) => !sector.active)}
                  >
                    {busy ? "Guardando…" : "Crear mesa"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {!sectors.length &&
            !loading.sectors &&
            !loadErrors.sectors &&
            canLoadDiningRoom && (
              <p className="muted">No hay sectores para mostrar.</p>
            )}
          <div className="record-list">
            {sectors.map((sector) => {
              const sectorTables = tables.filter(
                (table) => table.sectorId === sector.id,
              );
              const hasActiveAttention = sectorTables.some(
                (table) => table.state === "occupied",
              );
              return (
                <article
                  className="item-card"
                  key={`${sector.id}:${sector.version}`}
                >
                  <h4>
                    {sector.name} <span className="muted">({sector.code})</span>
                  </h4>
                  <p className="muted compact">
                    {sector.active ? "Activo" : "Inactivo"} · versión{" "}
                    {sector.version}
                  </p>
                  {canManageDiningRoom && (
                    <form
                      className="form-grid nested-form"
                      onSubmit={(event) =>
                        void onSaveSector(event, sector, hasActiveAttention)
                      }
                    >
                      <div className="field">
                        <label htmlFor={`sector-code-${sector.id}`}>
                          Código
                        </label>
                        <input
                          id={`sector-code-${sector.id}`}
                          name="code"
                          defaultValue={sector.code}
                          maxLength={32}
                          required
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`sector-name-${sector.id}`}>
                          Nombre
                        </label>
                        <input
                          id={`sector-name-${sector.id}`}
                          name="name"
                          defaultValue={sector.name}
                          maxLength={80}
                          required
                        />
                      </div>
                      <label className="check-row">
                        <input
                          type="checkbox"
                          name="active"
                          defaultChecked={sector.active}
                        />{" "}
                        Activo
                      </label>
                      <div className="form-actions">
                        <button
                          type="submit"
                          disabled={busy || hasActiveAttention}
                        >
                          {hasActiveAttention
                            ? "Bloqueado por atención activa"
                            : busy
                              ? "Guardando…"
                              : "Guardar sector"}
                        </button>
                      </div>
                    </form>
                  )}
                  {hasActiveAttention && canManageDiningRoom && (
                    <p className="field-hint">
                      No se puede editar el sector mientras una mesa tenga
                      atención activa.
                    </p>
                  )}
                  <div className="subsection">
                    <h5>Mapa de mesas</h5>
                    {!sectorTables.length && (
                      <p className="muted">
                        Este sector todavía no tiene mesas.
                      </p>
                    )}
                    <div className="record-list">
                      {sectorTables.map((table) => {
                        const attention = table.attention;
                        const canOpen =
                          canOperateTables &&
                          sector.active &&
                          table.active &&
                          table.state === "free";
                        return (
                          <div
                            className="item-card"
                            key={`${table.id}:${table.version}`}
                          >
                            <h5>{table.code}</h5>
                            <p
                              className={
                                table.state === "occupied"
                                  ? "pending"
                                  : "success"
                              }
                            >
                              {table.state === "occupied" ? "Ocupada" : "Libre"}{" "}
                              · {table.active ? "activa" : "inactiva"} ·
                              capacidad {table.capacity}
                            </p>
                            {(table.x !== null || table.y !== null) && (
                              <p className="muted compact">
                                Posición: X {table.x ?? "—"}, Y {table.y ?? "—"}
                              </p>
                            )}
                            {attention && (
                              <p className="muted compact">
                                {attention.status === "active"
                                  ? "Atención activa"
                                  : "Última atención cancelada"}{" "}
                                · {attention.waiterName} · {attention.guests}{" "}
                                comensales · {formatDate(attention.openedAt)}
                              </p>
                            )}
                            {canOpen && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenTableId(table.id);
                                  setOpenGuests("1");
                                }}
                                disabled={busy}
                              >
                                Seleccionar para abrir
                              </button>
                            )}
                            {canOperateTables &&
                              attention?.status === "active" && (
                                <form
                                  className="form-stack nested-form"
                                  onSubmit={(event) =>
                                    void onCancelAttention(event, table)
                                  }
                                >
                                  <div className="field">
                                    <label
                                      htmlFor={`cancel-reason-${attention.id}`}
                                    >
                                      Motivo para cancelar atención vacía
                                    </label>
                                    <input
                                      id={`cancel-reason-${attention.id}`}
                                      name="reason"
                                      required
                                    />
                                  </div>
                                  <button type="submit" disabled={busy}>
                                    {pendingAction ===
                                    `cancel-attention-${attention.id}`
                                      ? "Cancelando…"
                                      : "Cancelar atención"}
                                  </button>
                                </form>
                              )}
                            {canManageDiningRoom && (
                              <form
                                className="form-grid nested-form"
                                onSubmit={(event) =>
                                  void onSaveTable(event, table)
                                }
                              >
                                <div className="field">
                                  <label htmlFor={`table-code-${table.id}`}>
                                    Código
                                  </label>
                                  <input
                                    id={`table-code-${table.id}`}
                                    name="code"
                                    defaultValue={table.code}
                                    maxLength={32}
                                    required
                                  />
                                </div>
                                <div className="field">
                                  <label htmlFor={`table-sector-${table.id}`}>
                                    Sector
                                  </label>
                                  <select
                                    id={`table-sector-${table.id}`}
                                    name="sectorId"
                                    defaultValue={table.sectorId}
                                    required
                                  >
                                    {sectors.map((item) => (
                                      <option value={item.id} key={item.id}>
                                        {item.name}
                                        {item.active ? "" : " (inactivo)"}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="field">
                                  <label htmlFor={`table-capacity-${table.id}`}>
                                    Capacidad
                                  </label>
                                  <input
                                    id={`table-capacity-${table.id}`}
                                    name="capacity"
                                    type="number"
                                    min="1"
                                    max="100"
                                    step="1"
                                    defaultValue={table.capacity}
                                    required
                                  />
                                </div>
                                <div className="field">
                                  <label htmlFor={`table-x-${table.id}`}>
                                    Coordenada X
                                  </label>
                                  <input
                                    id={`table-x-${table.id}`}
                                    name="x"
                                    type="number"
                                    min="0"
                                    max="10000"
                                    step="1"
                                    defaultValue={table.x ?? ""}
                                  />
                                </div>
                                <div className="field">
                                  <label htmlFor={`table-y-${table.id}`}>
                                    Coordenada Y
                                  </label>
                                  <input
                                    id={`table-y-${table.id}`}
                                    name="y"
                                    type="number"
                                    min="0"
                                    max="10000"
                                    step="1"
                                    defaultValue={table.y ?? ""}
                                  />
                                </div>
                                <label className="check-row">
                                  <input
                                    type="checkbox"
                                    name="active"
                                    defaultChecked={table.active}
                                  />{" "}
                                  Activa
                                </label>
                                <div className="form-actions">
                                  <button
                                    type="submit"
                                    disabled={
                                      busy || table.state === "occupied"
                                    }
                                  >
                                    {table.state === "occupied"
                                      ? "Bloqueada por atención activa"
                                      : busy
                                        ? "Guardando…"
                                        : "Guardar mesa"}
                                  </button>
                                </div>
                              </form>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}
