import { Inject, Injectable } from '@nestjs/common';
import type {
  CampoError,
  GrupoEntradaValidada,
  GrupoModificarEntradaValidada,
  GrupoRespuesta,
} from '@restaurante/contratos';
import { precioEfectivo } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API, SQLSTATE, restriccionDe, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import {
  conflicto,
  datosInvalidos,
  enUso,
  nombreRepetido,
  noEncontrado,
  referenciaInvalida,
} from './errores-carta';
import { EventosCarta } from './eventos-carta';
import { productosSimplesActivos } from './referencias';
import { diferencias, sinCambioDeOrden } from './util-carta';

type Seleccion = 'UNICA' | 'MULTIPLE';

interface FilaGrupo {
  id: string;
  nombre: string;
  seleccion: Seleccion;
  minimo: number;
  maximo: number;
  activo: boolean;
}

interface FilaModificador {
  id: string;
  grupo_id: string;
  nombre: string;
  precio_extra: string;
  producto_id: string | null;
  producto_nombre: string | null;
  orden: number;
  activo: boolean;
}

/** Un modificador tal como queda después de una escritura (ya normalizado). */
interface ModificadorDeseado {
  /** Presente si actualiza uno guardado. */
  id: string | undefined;
  nombre: string;
  precioExtra: string;
  productoId: string | null;
  /** Posición en la lista enviada, desde 1. */
  orden: number;
}

/** Estado del grupo en los nombres de la API: lo que se compara y lo que va a la auditoría. */
interface EstadoGrupo extends Record<string, unknown> {
  nombre: string;
  seleccion: Seleccion;
  minimo: number;
  maximo: number;
  activo: boolean;
}

const CAMPOS_GRUPO = ['nombre', 'seleccion', 'minimo', 'maximo', 'activo'] as const;

const SELECT_MODIFICADORES = `SELECT m.id, m.grupo_id, m.nombre, m.precio_extra, m.producto_id,
    p.nombre AS producto_nombre, m.orden, m.activo
  FROM modificador m LEFT JOIN producto p ON p.id = m.producto_id`;

const MENSAJE_LIGADO = 'El producto ligado no existe, está inactivo o no es un producto simple';

const estadoDe = (g: FilaGrupo): EstadoGrupo => ({
  nombre: g.nombre,
  seleccion: g.seleccion,
  minimo: g.minimo,
  maximo: g.maximo,
  activo: g.activo,
});

/**
 * Grupos de modificadores y sus modificadores (HU-07, RF-16, criterios 24 a 29). Un grupo es una lista de
 * opciones (cada una con su precio extra y, si descuenta o prepara otro producto, ese producto ligado) que
 * se asigna a uno o más productos. Nada se borra: un modificador que sale de la lista y un grupo que se
 * quita pasan a inactivos. Todo corre dentro de la transacción de la petición, con su fila de auditoría
 * (los precios extra como texto exacto, antes y después) y el evento `carta.actualizada` después de
 * confirmar.
 *
 * Las reglas de mínimo, máximo y obligatorio se comprueban sobre el resultado de mezclar lo guardado con
 * lo enviado. Orden de los rechazos de `PATCH`: 400 de forma (el esquema), 404, 422 (modificador de otro
 * grupo o producto ligado inválido), 400 de las reglas, y 409 (`EN_USO` o nombre repetido).
 */
@Injectable()
export class GruposService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(EventosCarta) private readonly eventos: EventosCarta,
  ) {}

  // ---- Consultas -------------------------------------------------------------------------------

  /** Criterio 29: los grupos de la empresa ordenados por nombre. Tres consultas, sin importar cuántos. */
  async listar(): Promise<GrupoRespuesta[]> {
    const grupos = await this.conexion.query<FilaGrupo>(
      `SELECT id, nombre, seleccion, minimo, maximo, activo FROM grupo_modificadores
        ORDER BY lower(nombre), id`,
      { type: QueryTypes.SELECT },
    );
    return this.armar(grupos);
  }

  /** Criterio 29: un grupo. Uno de otra empresa responde 404 igual que uno inexistente. */
  async obtener(id: string): Promise<GrupoRespuesta> {
    const grupos = await this.conexion.query<FilaGrupo>(
      'SELECT id, nombre, seleccion, minimo, maximo, activo FROM grupo_modificadores WHERE id = $1',
      { bind: [id], type: QueryTypes.SELECT },
    );
    if (grupos[0] === undefined) throw noEncontrado('El grupo');
    return (await this.armar(grupos))[0]!;
  }

  /**
   * Arma la respuesta de los grupos dados: sus modificadores activos en su orden y los productos activos
   * que los usan (los productos inactivos no usan el grupo: no salen en la carta ni impiden desactivarlo).
   */
  private async armar(grupos: readonly FilaGrupo[]): Promise<GrupoRespuesta[]> {
    if (grupos.length === 0) return [];
    const ids = grupos.map((g) => g.id);
    const modificadores = await this.conexion.query<FilaModificador>(
      `${SELECT_MODIFICADORES} WHERE m.grupo_id = ANY($1::uuid[]) AND m.activo ORDER BY m.orden, m.id`,
      { bind: [ids], type: QueryTypes.SELECT },
    );
    const productos = await this.conexion.query<{ grupo_id: string; id: string; nombre: string }>(
      `SELECT pg.grupo_id, p.id, p.nombre FROM producto_grupo pg JOIN producto p ON p.id = pg.producto_id
        WHERE pg.grupo_id = ANY($1::uuid[]) AND p.activo ORDER BY lower(p.nombre), p.id`,
      { bind: [ids], type: QueryTypes.SELECT },
    );
    const modificadoresDe = new Map<string, FilaModificador[]>();
    for (const m of modificadores) {
      modificadoresDe.set(m.grupo_id, [...(modificadoresDe.get(m.grupo_id) ?? []), m]);
    }
    const productosDe = new Map<string, { id: string; nombre: string }[]>();
    for (const p of productos) {
      productosDe.set(p.grupo_id, [
        ...(productosDe.get(p.grupo_id) ?? []),
        { id: p.id, nombre: p.nombre },
      ]);
    }
    return grupos.map((g) => ({
      id: g.id,
      nombre: g.nombre,
      seleccion: g.seleccion,
      minimo: g.minimo,
      maximo: g.maximo,
      obligatorio: g.minimo >= 1,
      activo: g.activo,
      modificadores: (modificadoresDe.get(g.id) ?? []).map((m) => ({
        id: m.id,
        nombre: m.nombre,
        precioExtra: m.precio_extra,
        producto:
          m.producto_id === null ? null : { id: m.producto_id, nombre: m.producto_nombre ?? '' },
        orden: m.orden,
      })),
      productos: productosDe.get(g.id) ?? [],
    }));
  }

  // ---- Alta ------------------------------------------------------------------------------------

  /**
   * Criterios 24 a 26: crea el grupo con sus modificadores en el orden enviado. Las reglas de mínimo, máximo
   * y obligatorio ya las comprobó el esquema. Cada producto ligado debe ser un producto `SIMPLE` activo de la
   * empresa (422 `REFERENCIA_INVALIDA`, mismo cuerpo para uno de otra empresa y uno inexistente).
   */
  async crear(entrada: GrupoEntradaValidada): Promise<GrupoRespuesta> {
    const deseados = entrada.modificadores.map(aDeseado);
    const fallan = await this.validarLigados(deseados.map((m, i) => ({ indice: i, ...m })));
    if (fallan.length > 0) throw referenciaInvalida(fallan);

    const empresaId = this.contexto.empresaActual();
    const ahora = this.reloj.ahora();
    const estado = estadoDeEntrada(entrada);
    let id: string;
    try {
      const filas = await this.conexion.query<{ id: string }>(
        `INSERT INTO grupo_modificadores (empresa_id, nombre, seleccion, minimo, maximo, activo,
                                          creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, true, $6, $6) RETURNING id`,
        {
          bind: [empresaId, estado.nombre, estado.seleccion, estado.minimo, estado.maximo, ahora],
          type: QueryTypes.SELECT,
        },
      );
      id = filas[0]!.id;
      await this.insertarModificadores(id, deseados, ahora);
    } catch (error) {
      throw this.traducir(error);
    }
    const creados = await this.modificadoresDe(id, true);
    await this.auditoria.registrar({
      accion: 'crear_grupo_modificadores',
      entidad: 'grupo_modificadores',
      entidadId: id,
      detalle: {
        nombre: estado.nombre,
        seleccion: estado.seleccion,
        minimo: estado.minimo,
        maximo: estado.maximo,
        modificadores: creados.map((m) => ({
          id: m.id,
          nombre: m.nombre,
          precioExtra: m.precio_extra,
          productoId: m.producto_id,
        })),
      },
    });
    this.eventos.cartaActualizada(null);
    return this.obtener(id);
  }

  // ---- Edición ---------------------------------------------------------------------------------

  /** Criterios 27 y 29. Un `PATCH` que no cambia nada responde 200 sin auditoría ni evento. */
  async modificar(id: string, cambios: GrupoModificarEntradaValidada): Promise<GrupoRespuesta> {
    // El grupo y sus modificadores quedan bloqueados `FOR UPDATE`: quien asigna el grupo a un producto lo lee
    // `FOR SHARE`, así que no se cuela una asignación entre el conteo de `EN_USO` y la desactivación.
    const grupos = await this.conexion.query<FilaGrupo>(
      `SELECT id, nombre, seleccion, minimo, maximo, activo FROM grupo_modificadores
        WHERE id = $1 FOR UPDATE`,
      { bind: [id], type: QueryTypes.SELECT },
    );
    const guardado = grupos[0];
    if (guardado === undefined) throw noEncontrado('El grupo');
    await this.conexion.query(
      'SELECT id FROM modificador WHERE grupo_id = $1 ORDER BY id FOR UPDATE',
      { bind: [id], type: QueryTypes.SELECT },
    );
    const modificadoresGuardados = await this.modificadoresDe(id, false);
    const porId = new Map(modificadoresGuardados.map((m) => [m.id, m]));

    // 422: los `id` de la lista deben ser de este grupo, y los productos ligados que se agregan, cambian o
    // vuelven a ofrecerse deben ser simples y activos (criterios 26 y 27).
    const deseados = cambios.modificadores?.map(aDeseado);
    const reactivaGrupo = !guardado.activo && cambios.activo === true;
    const fallan: CampoError[] = [];
    const porValidar: { indice: number; productoId: string | null }[] = [];
    if (deseados !== undefined) {
      deseados.forEach((m, indice) => {
        const actual = m.id === undefined ? undefined : porId.get(m.id);
        if (m.id !== undefined && actual === undefined) {
          fallan.push({
            campo: `modificadores.${indice}.id`,
            mensaje: 'El modificador no existe en este grupo',
          });
          return;
        }
        const cambiaLigado = actual === undefined || actual.producto_id !== m.productoId;
        if (cambiaLigado || !actual.activo || reactivaGrupo) {
          porValidar.push({ indice, productoId: m.productoId });
        }
      });
    } else if (reactivaGrupo) {
      modificadoresGuardados.forEach((m, indice) => {
        if (m.activo) porValidar.push({ indice, productoId: m.producto_id });
      });
    }
    fallan.push(...(await this.validarLigados(porValidar, 'modificadores')));
    if (fallan.length > 0) throw referenciaInvalida(fallan);

    // 400: las reglas sobre el resultado.
    const antes = estadoDe(guardado);
    const cantidad = deseados?.length ?? modificadoresGuardados.filter((m) => m.activo).length;
    const despues = this.mezclar(antes, cambios, cantidad);

    // Diferencias.
    const cambiosGrupo = diferencias(antes, despues, CAMPOS_GRUPO);
    const detalleModificadores =
      deseados === undefined
        ? undefined
        : diferenciasDeModificadores(modificadoresGuardados, deseados);
    const hayCambioDeModificadores =
      detalleModificadores !== undefined && !detalleModificadores.vacio;
    if (Object.keys(cambiosGrupo).length === 0 && !hayCambioDeModificadores) {
      return this.obtener(id);
    }

    // 409: desactivar un grupo que usan productos activos.
    if (guardado.activo && !despues.activo) {
      const usan = await this.conexion.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM producto_grupo pg JOIN producto p ON p.id = pg.producto_id
          WHERE pg.grupo_id = $1 AND p.activo`,
        { bind: [id], type: QueryTypes.SELECT },
      );
      const n = usan[0]!.n;
      if (n > 0) {
        throw enUso(
          n === 1
            ? 'Este grupo lo usa 1 producto activo. Quítalo de ese producto antes de desactivarlo'
            : `Este grupo lo usan ${n} productos activos. Quítalo de esos productos antes de desactivarlo`,
        );
      }
    }

    const ahora = this.reloj.ahora();
    try {
      if (Object.keys(cambiosGrupo).length > 0) {
        await this.conexion.query(
          `UPDATE grupo_modificadores SET nombre = $2, seleccion = $3, minimo = $4, maximo = $5,
                  activo = $6, actualizado_en = $7 WHERE id = $1`,
          {
            bind: [
              id,
              despues.nombre,
              despues.seleccion,
              despues.minimo,
              despues.maximo,
              despues.activo,
              ahora,
            ],
          },
        );
      }
      if (deseados !== undefined) {
        await this.reemplazarModificadores(id, modificadoresGuardados, deseados, ahora);
      }
    } catch (error) {
      throw this.traducir(error);
    }

    await this.auditoria.registrar({
      accion: 'modificar_grupo_modificadores',
      entidad: 'grupo_modificadores',
      entidadId: id,
      detalle: {
        ...cambiosGrupo,
        ...(hayCambioDeModificadores ? { modificadores: detalleModificadores.detalle } : {}),
      },
    });
    this.eventos.cartaActualizada(null);
    return this.obtener(id);
  }

  // ---- Reglas ----------------------------------------------------------------------------------

  /**
   * Criterio 25 sobre el resultado: mezcla lo guardado con lo enviado y lanza 400 `DATOS_INVALIDOS` si no
   * cumple. `cantidad` es la cantidad de modificadores activos que quedan.
   */
  private mezclar(
    guardado: EstadoGrupo,
    cambios: GrupoModificarEntradaValidada,
    cantidad: number,
  ): EstadoGrupo {
    const campos: CampoError[] = [];
    const seleccion = cambios.seleccion ?? guardado.seleccion;
    let minimo = guardado.minimo;
    let maximo = guardado.maximo;
    if (seleccion === 'UNICA') {
      // Sin `seleccion` en el cuerpo, el grupo guardado ya es `UNICA` (el esquema exige los campos de cada
      // selección cuando se envía): el mínimo y el máximo no se pueden enviar sueltos.
      if (cambios.minimo !== undefined) {
        campos.push({ campo: 'minimo', mensaje: 'Una selección única no lleva mínimo' });
      }
      if (cambios.maximo !== undefined) {
        campos.push({ campo: 'maximo', mensaje: 'Una selección única no lleva máximo' });
      }
      const obligatorio = cambios.obligatorio ?? guardado.minimo >= 1;
      minimo = obligatorio ? 1 : 0;
      maximo = 1;
    } else {
      if (cambios.obligatorio !== undefined) {
        campos.push({
          campo: 'obligatorio',
          mensaje: 'Una selección múltiple se obliga con el mínimo',
        });
      }
      minimo = cambios.minimo ?? guardado.minimo;
      maximo = cambios.maximo ?? guardado.maximo;
      if (minimo > maximo) {
        campos.push({ campo: 'minimo', mensaje: 'El mínimo no puede ser mayor que el máximo' });
      } else if (minimo > cantidad) {
        campos.push({
          campo: 'minimo',
          mensaje: 'El mínimo no puede ser mayor que la cantidad de modificadores',
        });
      }
    }
    if (campos.length > 0) throw datosInvalidos(campos);
    return {
      nombre: cambios.nombre ?? guardado.nombre,
      seleccion,
      minimo,
      maximo,
      activo: cambios.activo ?? guardado.activo,
    };
  }

  /**
   * Criterio 26: los productos ligados deben ser `SIMPLE` y estar activos. Una sola consulta, bajo RLS (uno de
   * otra empresa no aparece y falla igual que uno inexistente), con `FOR SHARE`. Devuelve un campo por cada
   * elemento que falla.
   */
  private async validarLigados(
    elementos: readonly { indice: number; productoId: string | null }[],
    prefijo = 'modificadores',
  ): Promise<CampoError[]> {
    const pedidos = elementos.filter((e) => e.productoId !== null);
    if (pedidos.length === 0) return [];
    const validos = await productosSimplesActivos(
      this.conexion,
      pedidos.map((e) => e.productoId!),
      'SHARE',
    );
    return pedidos
      .filter((e) => !validos.has(e.productoId!.toLowerCase()))
      .map((e) => ({ campo: `${prefijo}.${e.indice}.productoId`, mensaje: MENSAJE_LIGADO }));
  }

  // ---- Escritura de modificadores ---------------------------------------------------------------

  private async modificadoresDe(grupoId: string, soloActivos: boolean): Promise<FilaModificador[]> {
    return this.conexion.query<FilaModificador>(
      `${SELECT_MODIFICADORES} WHERE m.grupo_id = $1${soloActivos ? ' AND m.activo' : ''}
        ORDER BY m.orden, m.id`,
      { bind: [grupoId], type: QueryTypes.SELECT },
    );
  }

  private async insertarModificadores(
    grupoId: string,
    modificadores: readonly ModificadorDeseado[],
    ahora: Date,
  ): Promise<void> {
    if (modificadores.length === 0) return;
    await this.conexion.query(
      `INSERT INTO modificador (empresa_id, grupo_id, nombre, precio_extra, producto_id, orden, activo,
                                creado_en, actualizado_en)
       SELECT $1, $2, v.nombre, v.precio_extra, v.producto_id, v.orden, true, $7, $7
         FROM unnest($3::text[], $4::numeric[], $5::uuid[], $6::int[])
              AS v(nombre, precio_extra, producto_id, orden)`,
      {
        bind: [
          this.contexto.empresaActual(),
          grupoId,
          modificadores.map((m) => m.nombre),
          modificadores.map((m) => m.precioExtra),
          modificadores.map((m) => m.productoId),
          modificadores.map((m) => m.orden),
          ahora,
        ],
      },
    );
  }

  /**
   * Reemplaza la lista de modificadores (criterio 27): los que ya no aparecen pasan a inactivos, los que traen
   * `id` se actualizan (y se reactivan si estaban inactivos), y los demás se crean. El orden de las
   * operaciones evita que el único parcial por nombre rechace un intercambio de nombres: primero salen los
   * que se quitan, luego los que cambian de nombre toman uno provisional, y al final se escriben los valores
   * nuevos y se insertan los creados.
   */
  private async reemplazarModificadores(
    grupoId: string,
    guardados: readonly FilaModificador[],
    deseados: readonly ModificadorDeseado[],
    ahora: Date,
  ): Promise<void> {
    const enLista = new Set(deseados.flatMap((m) => (m.id === undefined ? [] : [m.id])));
    const salen = guardados.filter((m) => m.activo && !enLista.has(m.id)).map((m) => m.id);
    if (salen.length > 0) {
      await this.conexion.query(
        'UPDATE modificador SET activo = false, actualizado_en = $2 WHERE id = ANY($1::uuid[])',
        { bind: [salen, ahora] },
      );
    }
    const porId = new Map(guardados.map((m) => [m.id, m]));
    const existentes = deseados.filter((m) => m.id !== undefined);
    const cambianNombre = existentes.filter((m) => porId.get(m.id!)!.nombre !== m.nombre);
    if (cambianNombre.length > 0) {
      await this.conexion.query(
        'UPDATE modificador SET nombre = id::text WHERE id = ANY($1::uuid[])',
        { bind: [cambianNombre.map((m) => m.id)] },
      );
    }
    const aEscribir = existentes.filter((m) => {
      const g = porId.get(m.id!)!;
      return (
        g.nombre !== m.nombre ||
        g.precio_extra !== m.precioExtra ||
        g.producto_id !== m.productoId ||
        g.orden !== m.orden ||
        !g.activo
      );
    });
    if (aEscribir.length > 0) {
      await this.conexion.query(
        `UPDATE modificador SET nombre = v.nombre, precio_extra = v.precio_extra,
                producto_id = v.producto_id, orden = v.orden, activo = true, actualizado_en = $6
           FROM unnest($1::uuid[], $2::text[], $3::numeric[], $4::uuid[], $5::int[])
                AS v(id, nombre, precio_extra, producto_id, orden)
          WHERE modificador.id = v.id`,
        {
          bind: [
            aEscribir.map((m) => m.id),
            aEscribir.map((m) => m.nombre),
            aEscribir.map((m) => m.precioExtra),
            aEscribir.map((m) => m.productoId),
            aEscribir.map((m) => m.orden),
            ahora,
          ],
        },
      );
    }
    await this.insertarModificadores(
      grupoId,
      deseados.filter((m) => m.id === undefined),
      ahora,
    );
  }

  /** 23505 sobre el nombre del grupo o de un modificador → 409; 23503 que escapó a la validación → 422. */
  private traducir(error: unknown): unknown {
    switch (sqlstateDe(error)) {
      case SQLSTATE.VIOLACION_UNICIDAD:
        return restriccionDe(error) === 'modificador_nombre_unico'
          ? conflicto('Dos modificadores del grupo tienen el mismo nombre', [
              { campo: 'modificadores', mensaje: 'Nombre repetido dentro del grupo' },
            ])
          : nombreRepetido('un grupo');
      case SQLSTATE.VIOLACION_LLAVE_FORANEA:
        return referenciaInvalida([{ campo: 'modificadores', mensaje: MENSAJE_LIGADO }]);
      default:
        return error;
    }
  }
}

/** Un modificador de la entrada, con el precio extra a 2 decimales y los ids en minúsculas. */
function aDeseado(
  m: { id?: string; nombre: string; precioExtra: string; productoId: string | null },
  indice: number,
): ModificadorDeseado {
  return {
    id: m.id?.toLowerCase(),
    nombre: m.nombre,
    precioExtra: precioEfectivo(m.precioExtra, null) ?? '0.00',
    productoId: m.productoId?.toLowerCase() ?? null,
    orden: indice + 1,
  };
}

/** Selección, mínimo y máximo del alta (criterio 25): `UNICA` lleva máximo 1 y mínimo 1 si es obligatoria. */
function estadoDeEntrada(entrada: GrupoEntradaValidada): EstadoGrupo {
  if (entrada.seleccion === 'UNICA') {
    return {
      nombre: entrada.nombre,
      seleccion: 'UNICA',
      minimo: entrada.obligatorio ? 1 : 0,
      maximo: 1,
      activo: true,
    };
  }
  return {
    nombre: entrada.nombre,
    seleccion: 'MULTIPLE',
    minimo: entrada.minimo,
    maximo: entrada.maximo,
    activo: true,
  };
}

interface DiferenciasDeModificadores {
  vacio: boolean;
  detalle: {
    creados: { nombre: string; precioExtra: string; productoId: string | null }[];
    cambiados: Record<string, unknown>[];
    desactivados: { id: string; nombre: string; precioExtra: string }[];
    orden?: { antes: string[]; despues: string[] };
  };
}

/**
 * Lo que cambia en la lista de modificadores, para la auditoría y para el "no cambia nada": los creados, los
 * cambiados (con el antes y el después de cada campo, también los precios extra y las reactivaciones), los
 * desactivados, y el orden si cambió entre los que quedan. Solo cuenta lo que se ve: renumerar las
 * posiciones al quitar uno no es un cambio.
 */
function diferenciasDeModificadores(
  guardados: readonly FilaModificador[],
  deseados: readonly ModificadorDeseado[],
): DiferenciasDeModificadores {
  const porId = new Map(guardados.map((m) => [m.id, m]));
  const enLista = new Set(deseados.flatMap((m) => (m.id === undefined ? [] : [m.id])));
  const creados = deseados
    .filter((m) => m.id === undefined)
    .map((m) => ({ nombre: m.nombre, precioExtra: m.precioExtra, productoId: m.productoId }));
  const desactivados = guardados
    .filter((m) => m.activo && !enLista.has(m.id))
    .map((m) => ({ id: m.id, nombre: m.nombre, precioExtra: m.precio_extra }));
  const cambiados: Record<string, unknown>[] = [];
  for (const m of deseados) {
    if (m.id === undefined) continue;
    const g = porId.get(m.id)!;
    const cambios = diferencias(
      {
        nombre: g.nombre,
        precioExtra: g.precio_extra,
        productoId: g.producto_id,
        activo: g.activo,
      },
      { nombre: m.nombre, precioExtra: m.precioExtra, productoId: m.productoId, activo: true },
      ['nombre', 'precioExtra', 'productoId', 'activo'],
    );
    if (Object.keys(cambios).length > 0) cambiados.push({ id: m.id, nombre: m.nombre, ...cambios });
  }
  // Orden entre los que siguen activos y ya existían.
  const antes = guardados.filter((m) => m.activo && enLista.has(m.id)).map((m) => m.id);
  const despues = deseados.flatMap((m) =>
    m.id !== undefined && antes.includes(m.id) ? [m.id] : [],
  );
  const cambiaOrden = !sinCambioDeOrden(antes, despues);
  const detalle: DiferenciasDeModificadores['detalle'] = { creados, cambiados, desactivados };
  if (cambiaOrden) detalle.orden = { antes, despues };
  return {
    vacio:
      creados.length === 0 && cambiados.length === 0 && desactivados.length === 0 && !cambiaOrden,
    detalle,
  };
}
