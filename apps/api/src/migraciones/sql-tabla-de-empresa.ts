/**
 * Generadores de SQL para las migraciones de tablas con datos de clientes. Cada migración que crea
 * una tabla de empresa debe usar `sqlTablaDeEmpresa` (o `sqlTablaDePlataforma` para una tabla que
 * solo toca la vía de plataforma) en la misma migración que la crea: así la RLS, la política y los
 * privilegios explícitos nunca se olvidan (criterio 38 de la historia 001).
 *
 * Nunca se concede `TRUNCATE`, `REFERENCES` ni `TRIGGER`: `TRUNCATE` ignora la RLS.
 *
 * Historia 002: las tablas nuevas usan `sqlTablaDeEmpresaTrazable` (al final de este archivo), que
 * agrega la trazabilidad de quién creó y quién cambió cada fila.
 */

export type PrivilegioDml = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

const PRIVILEGIOS_VALIDOS: readonly PrivilegioDml[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/;

function identificador(valor: string): string {
  if (!IDENTIFICADOR.test(valor)) {
    throw new Error(`Identificador SQL no permitido en la migración: "${valor}"`);
  }
  return valor;
}

function privilegios(lista: readonly PrivilegioDml[]): string {
  if (lista.length === 0) throw new Error('Se necesita al menos un privilegio');
  for (const privilegio of lista) {
    if (!PRIVILEGIOS_VALIDOS.includes(privilegio)) {
      throw new Error(`Privilegio no permitido: ${String(privilegio)}`);
    }
  }
  return [...new Set(lista)].join(', ');
}

export interface OpcionesTablaDeEmpresa {
  /** Privilegios de `restaurante_api` (se aplican bajo la política `aislamiento_empresa`). */
  privilegiosApi: readonly PrivilegioDml[];
  /** Privilegios de `restaurante_plataforma`, si la tabla también se toca por esa vía. */
  privilegiosPlataforma?: readonly PrivilegioDml[];
  /** Columna con la empresa dueña de la fila; `id` en la propia tabla `empresa`. Por defecto `empresa_id`. */
  columnaEmpresa?: string;
}

/**
 * RLS activada y forzada, política `aislamiento_empresa` para `restaurante_api` (con
 * `empresa_actual()` en `USING` y `WITH CHECK`), política `acceso_plataforma` si corresponde y los
 * `GRANT` explícitos. La tabla ya debe existir.
 */
export function sqlTablaDeEmpresa(tabla: string, opciones: OpcionesTablaDeEmpresa): string {
  const t = identificador(tabla);
  const columna = identificador(opciones.columnaEmpresa ?? 'empresa_id');
  const partes = [
    `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY aislamiento_empresa ON ${t} AS PERMISSIVE FOR ALL TO restaurante_api
       USING (${columna} = (SELECT empresa_actual()))
       WITH CHECK (${columna} = (SELECT empresa_actual()));`,
    `GRANT ${privilegios(opciones.privilegiosApi)} ON ${t} TO restaurante_api;`,
  ];
  if (opciones.privilegiosPlataforma) {
    partes.push(sqlTablaDePlataforma(t, opciones.privilegiosPlataforma, { activarRls: false }));
  }
  return partes.join('\n');
}

/**
 * Tabla que solo toca `restaurante_plataforma` (por ejemplo la auditoría): RLS forzada, política
 * `acceso_plataforma` y privilegios explícitos. `restaurante_api` no recibe nada.
 */
export function sqlTablaDePlataforma(
  tabla: string,
  privilegiosPlataforma: readonly PrivilegioDml[],
  opciones: { activarRls?: boolean } = {},
): string {
  const t = identificador(tabla);
  const partes: string[] = [];
  if (opciones.activarRls !== false) {
    partes.push(
      `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`,
    );
  }
  partes.push(
    `CREATE POLICY acceso_plataforma ON ${t} AS PERMISSIVE FOR ALL TO restaurante_plataforma
       USING (true) WITH CHECK (true);`,
    `GRANT ${privilegios(privilegiosPlataforma)} ON ${t} TO restaurante_plataforma;`,
  );
  return partes.join('\n');
}

export interface OpcionesTrazabilidad {
  /** Columna con la empresa dueña de la fila; `id` en la propia tabla `empresa`. Por defecto `empresa_id`. */
  columnaEmpresa?: string;
}

/**
 * Agrega a una tabla ya creada las columnas `creado_por_*` y `actualizado_por_*` (usuario, equipo,
 * superadministrador y sistema), sus `CHECK` (exactamente uno entre usuario, superadministrador y
 * sistema; equipo solo con usuario), las llaves foráneas compuestas con la empresa y el trigger
 * `trazabilidad` (criterios 113 a 115). `sqlTablaDeEmpresa` no cambia: la usan las migraciones de 001.
 * Lógica en la tarea T7 (hasta entonces lanza `Error('No implementado')`).
 */
export function sqlTrazabilidad(_tabla: string, _opciones: OpcionesTrazabilidad = {}): string {
  throw new Error('No implementado');
}

/**
 * `sqlTablaDeEmpresa` más `sqlTrazabilidad`: toda tabla nueva con datos de clientes se crea con esta
 * función, salvo las excepciones de la lista cerrada (`auditoria`, `sesion`, `bloqueo_intentos` e
 * `idempotencia`). Lógica en la tarea T7 (hasta entonces lanza `Error('No implementado')`).
 */
export function sqlTablaDeEmpresaTrazable(
  _tabla: string,
  _opciones: OpcionesTablaDeEmpresa,
): string {
  throw new Error('No implementado');
}
