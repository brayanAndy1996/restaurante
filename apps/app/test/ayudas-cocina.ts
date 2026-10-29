import type { CocinaRespuesta, ComandaKds, LineaKds } from '@restaurante/contratos';
import { AHORA, uuid } from './ayudas-salon';

/** Una línea de comanda del KDS; por defecto, un Lomo saltado × 1 recién enviado. */
export function lineaKds(n: number, extra: Partial<LineaKds> = {}): LineaKds {
  return {
    id: uuid(3000 + n),
    itemId: uuid(1000 + n),
    rol: 'PRODUCTO',
    nombre: 'Lomo saltado',
    contexto: null,
    cantidad: 1,
    modificadores: [],
    observacion: null,
    tiempo: 1,
    esperar: false,
    paraLlevar: false,
    estado: 'ENVIADO',
    ...extra,
  };
}

export const Z_COCINA = uuid(40);
export const Z_BARRA = uuid(41);

interface OpcionesDeComanda extends Partial<Omit<ComandaKds, 'orden' | 'estacion' | 'creadaEn'>> {
  /** Cuántos minutos antes de `AHORA` llegó (o `creadaEn`, si se quiere una hora exacta). */
  hace?: number;
  creadaEn?: string;
  mesas?: { id: string; nombre: string }[];
  estacion?: { id: string; nombre: string };
  mozo?: string;
}

/** Una comanda del KDS de la mesa `mesa`; `n` da su id y el de su orden. */
export function comandaKds(n: number, opciones: OpcionesDeComanda = {}): ComandaKds {
  const { hace = 3, creadaEn, mesas, estacion, mozo, ...resto } = opciones;
  return {
    id: uuid(2000 + n),
    tipo: 'COMANDA',
    creadaEn: creadaEn ?? new Date(Date.parse(AHORA) - hace * 60_000).toISOString(),
    vistaEn: null,
    motivo: null,
    estacion: estacion ?? { id: Z_COCINA, nombre: 'Cocina' },
    orden: {
      id: uuid(900 + n),
      mesas: mesas ?? [{ id: uuid(100 + n), nombre: String(n) }],
      mozo: { id: uuid(800), nombre: mozo ?? 'Ana Ríos' },
      comensales: 3,
    },
    lineas: [lineaKds(n)],
    ...resto,
  };
}

export function cocinaDe(pendientes: ComandaKds[], recientes: ComandaKds[] = []): CocinaRespuesta {
  return { ahora: AHORA, pendientes, recientes };
}
