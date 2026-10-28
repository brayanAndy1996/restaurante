import { Inject, Injectable } from '@nestjs/common';
import type {
  CampoError,
  OrdenEntrada,
  ProductoCrearEntradaValidada,
  ProductoModificarEntrada,
  ProductoRespuesta,
  ProductoResumen,
} from '@restaurante/contratos';
import { precioEfectivo } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API, SQLSTATE, restriccionDe, sqlstateDe } from '../../nucleo/base-de-datos';
import { ALMACEN_ARCHIVOS, type AlmacenArchivos } from '../../nucleo/archivos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { SucursalesConsultaService } from '../plataforma';
import {
  conflicto,
  confirmacionRequerida,
  datosInvalidos,
  enUsoPorCambioDeTipo,
  nombreRepetido,
  noEncontrado,
  referenciaInvalida,
} from './errores-carta';
import { EventosCarta } from './eventos-carta';
import { PermisosCarta } from './permisos-carta';
import {
  borrarOpcionesDelDia,
  calcularSeQuita,
  hayQueQuitar,
  mensajeDeConfirmacion,
  mensajeEnUso,
  reglasDelTipo,
  seUsa,
  usadoEnDe,
  type ComponenteGuardado,
  type TipoProducto,
} from './cambio-tipo';
import { gruposActivos, productosSimplesActivos, validarFamiliaYEstacion } from './referencias';
import { aIso, diferencias, sinCambioDeOrden, type Cambio } from './util-carta';

/** Fila de `producto` tal como la leen las consultas de este servicio. */
interface FilaProducto {
  id: string;
  familia_id: string;
  tipo: TipoProducto;
  nombre: string;
  descripcion: string | null;
  precio: string | null;
  se_vende_solo: boolean;
  afectacion_igv: 'GRAVADO' | 'EXONERADO' | 'INAFECTO';
  aplica_icbper: boolean;
  estacion_id: string | null;
  tipo_control_stock: 'UNIDADES' | 'PORCIONES' | 'SIN_CONTROL';
  foto_clave: string | null;
  orden: number;
  activo: boolean;
  creado_en: Date;
  actualizado_en: Date;
}

const COLUMNAS = `p.id, p.familia_id, p.tipo, p.nombre, p.descripcion, p.precio, p.se_vende_solo,
  p.afectacion_igv, p.aplica_icbper, p.estacion_id, p.tipo_control_stock, p.foto_clave, p.orden, p.activo,
  p.creado_en, p.actualizado_en`;

/** Estado de un producto en los nombres de la API: lo que se compara y lo que va a la auditoría. */
interface EstadoProducto extends Record<string, unknown> {
  tipo: TipoProducto;
  nombre: string;
  descripcion: string | null;
  familiaId: string;
  precio: string | null;
  seVendeSolo: boolean;
  afectacionIgv: string;
  aplicaIcbper: boolean;
  estacionId: string | null;
  tipoControlStock: string;
  activo: boolean;
}

const CAMPOS_AUDITADOS = [
  'tipo',
  'nombre',
  'descripcion',
  'familiaId',
  'precio',
  'seVendeSolo',
  'afectacionIgv',
  'aplicaIcbper',
  'estacionId',
  'tipoControlStock',
  'activo',
] as const;

const estadoDe = (f: FilaProducto): EstadoProducto => ({
  tipo: f.tipo,
  nombre: f.nombre,
  descripcion: f.descripcion,
  familiaId: f.familia_id,
  precio: f.precio,
  seVendeSolo: f.se_vende_solo,
  afectacionIgv: f.afectacion_igv,
  aplicaIcbper: f.aplica_icbper,
  estacionId: f.estacion_id,
  tipoControlStock: f.tipo_control_stock,
  activo: f.activo,
});

/** Normaliza un monto de entrada (`"25"`, `"19.9"`) a 2 decimales con `packages/dominio`. */
const aDosDecimales = (monto: string | null | undefined): string | null =>
  monto === undefined || monto === null ? null : precioEfectivo(monto, null);

const ordenInvalido = () =>
  datosInvalidos([{ campo: 'ids', mensaje: 'Debe contener exactamente una vez cada producto' }]);

/**
 * Productos de la carta (HU-05, HU-08, RF-14, RF-17, RF-18, criterios 6 a 13 y 30 a 33): los tres tipos
 * (`SIMPLE`, `COMBO` y `MENU_DEL_DIA`), con sus grupos de modificadores y sus componentes, y el cambio de tipo
 * (criterios 10b a 10d). Todo corre dentro de la transacción de la petición y deja su fila de auditoría en
 * ella, con el antes y el después de cada cambio (los precios como texto exacto).
 *
 * **Orden de bloqueo** (para no formar esperas cruzadas con `GruposService`, que bloquea el grupo y después
 * los productos ligados, y con el orden de una familia): familia, estación, grupos y, al final, productos.
 * Un `PATCH` bloquea antes de leer el producto la familia de destino y los grupos que el cuerpo menciona
 * (`bloquearEnOrden`); un alta lee familia, estación, grupos y componentes en ese orden.
 */
@Injectable()
export class ProductosService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(EventosCarta) private readonly eventos: EventosCarta,
    @Inject(ALMACEN_ARCHIVOS) private readonly almacen: AlmacenArchivos,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(PermisosCarta) private readonly permisos: PermisosCarta,
  ) {}

  private fotoUrl(clave: string | null): string | null {
    return clave === null ? null : this.almacen.urlPublica(clave);
  }

  private aResumen(f: FilaProducto): ProductoResumen {
    return {
      id: f.id,
      tipo: f.tipo,
      nombre: f.nombre,
      familiaId: f.familia_id,
      precio: f.precio,
      seVendeSolo: f.se_vende_solo,
      estacionId: f.estacion_id,
      tipoControlStock: f.tipo_control_stock,
      fotoUrl: this.fotoUrl(f.foto_clave),
      activo: f.activo,
      orden: f.orden,
    };
  }

  // ---- Consultas -------------------------------------------------------------------------------

  /** Criterio 12: todos los productos de la empresa, por el orden de su familia y luego por el suyo. */
  async listar(): Promise<ProductoResumen[]> {
    const filas = await this.conexion.query<FilaProducto>(
      `SELECT ${COLUMNAS} FROM producto p JOIN familia f ON f.id = p.familia_id
        ORDER BY f.orden, f.id, p.orden, p.id`,
      { type: QueryTypes.SELECT },
    );
    return filas.map((f) => this.aResumen(f));
  }

  /** Criterio 12: el producto completo. Un id de otra empresa responde 404 igual que uno inexistente. */
  async obtener(id: string): Promise<ProductoRespuesta> {
    const filas = await this.conexion.query<FilaProducto>(
      `SELECT ${COLUMNAS} FROM producto p WHERE p.id = $1`,
      { bind: [id], type: QueryTypes.SELECT },
    );
    const f = filas[0];
    if (f === undefined) throw noEncontrado('El producto');
    return {
      ...this.aResumen(f),
      descripcion: f.descripcion,
      afectacionIgv: f.afectacion_igv,
      aplicaIcbper: f.aplica_icbper,
      grupos: await this.gruposDe(id),
      componentes: await this.componentesDe(id),
      usadoEn: await usadoEnDe(this.conexion, id),
      creadoEn: aIso(f.creado_en),
      actualizadoEn: aIso(f.actualizado_en),
    };
  }

  /** Los grupos asignados al producto, en su orden (criterio 12). */
  private async gruposDe(productoId: string): Promise<{ id: string; nombre: string }[]> {
    return this.conexion.query<{ id: string; nombre: string }>(
      `SELECT g.id, g.nombre FROM producto_grupo pg JOIN grupo_modificadores g ON g.id = pg.grupo_id
        WHERE pg.producto_id = $1 ORDER BY pg.orden, g.id`,
      { bind: [productoId], type: QueryTypes.SELECT },
    );
  }

  /** Los componentes del combo con su nombre y cantidad, en su orden (criterio 12). */
  private async componentesDe(comboId: string): Promise<ComponenteGuardado[]> {
    return this.conexion.query<ComponenteGuardado>(
      `SELECT cc.producto_id AS "productoId", p.nombre, cc.cantidad::int AS cantidad
         FROM componente_combo cc JOIN producto p ON p.id = cc.producto_id
        WHERE cc.combo_id = $1 ORDER BY cc.orden, p.id`,
      { bind: [comboId], type: QueryTypes.SELECT },
    );
  }

  /**
   * Los grupos de `ids` que no se pueden asignar (no existen, son de otra empresa o están inactivos), con
   * `FOR SHARE`: quien desactiva un grupo lo bloquea `FOR UPDATE`, así que se serializan (criterio 29).
   */
  private async gruposNoAsignables(ids: readonly string[]): Promise<CampoError[]> {
    if (ids.length === 0) return [];
    const activos = await gruposActivos(this.conexion, ids, 'SHARE');
    return ids.some((id) => !activos.has(id.toLowerCase()))
      ? [{ campo: 'gruposModificadores', mensaje: 'Uno de los grupos no existe o está inactivo' }]
      : [];
  }

  /** Escribe la lista de grupos del producto con su orden (borra los que salen, inserta o reordena el resto). */
  private async escribirGrupos(
    productoId: string,
    ids: readonly string[],
    ahora: Date,
  ): Promise<void> {
    await this.conexion.query(
      'DELETE FROM producto_grupo WHERE producto_id = $1 AND grupo_id <> ALL($2::uuid[])',
      { bind: [productoId, [...ids]] },
    );
    if (ids.length === 0) return;
    await this.conexion.query(
      `INSERT INTO producto_grupo (empresa_id, producto_id, grupo_id, orden, creado_en, actualizado_en)
       SELECT $1, $2, v.grupo_id, v.orden, $4, $4
         FROM unnest($3::uuid[]) WITH ORDINALITY AS v(grupo_id, orden)
       ON CONFLICT (producto_id, grupo_id)
       DO UPDATE SET orden = EXCLUDED.orden, actualizado_en = EXCLUDED.actualizado_en
        WHERE producto_grupo.orden <> EXCLUDED.orden`,
      { bind: [this.contexto.empresaActual(), productoId, [...ids], ahora] },
    );
  }

  /**
   * Escribe la lista de componentes del combo con su orden y cantidad (borra los que salen; inserta o actualiza
   * el resto). Los productos componentes ya se leyeron `FOR SHARE` al validarlos.
   */
  private async escribirComponentes(
    comboId: string,
    lista: readonly { productoId: string; cantidad: number }[],
    ahora: Date,
  ): Promise<void> {
    await this.conexion.query(
      'DELETE FROM componente_combo WHERE combo_id = $1 AND producto_id <> ALL($2::uuid[])',
      { bind: [comboId, lista.map((c) => c.productoId)] },
    );
    if (lista.length === 0) return;
    await this.conexion.query(
      `INSERT INTO componente_combo (empresa_id, combo_id, producto_id, cantidad, orden, creado_en,
                                     actualizado_en)
       SELECT $1, $2, v.producto_id, v.cantidad, v.orden, $5, $5
         FROM unnest($3::uuid[], $4::smallint[]) WITH ORDINALITY AS v(producto_id, cantidad, orden)
       ON CONFLICT (combo_id, producto_id)
       DO UPDATE SET cantidad = EXCLUDED.cantidad, orden = EXCLUDED.orden,
                     actualizado_en = EXCLUDED.actualizado_en
        WHERE componente_combo.cantidad <> EXCLUDED.cantidad
           OR componente_combo.orden <> EXCLUDED.orden`,
      {
        bind: [
          this.contexto.empresaActual(),
          comboId,
          lista.map((c) => c.productoId),
          lista.map((c) => c.cantidad),
          ahora,
        ],
      },
    );
  }

  /**
   * Los componentes de `ids` que no se pueden agregar (no existen, son de otra empresa, están inactivos o no son
   * simples: un combo no contiene combos ni menús, criterio 9), con `FOR SHARE`: un cambio de tipo concurrente
   * del producto lo bloquea `FOR UPDATE` y se serializan (criterio 10c). `propio` es el combo que se edita: un
   * producto no puede ser componente de sí mismo.
   */
  private async componentesNoAgregables(
    ids: readonly string[],
    propio?: string,
  ): Promise<CampoError[]> {
    if (ids.length === 0) return [];
    const simples = await productosSimplesActivos(this.conexion, ids, 'SHARE');
    const mala = ids.some((id) => id === propio || !simples.has(id));
    return mala
      ? [
          {
            campo: 'componentes',
            mensaje: 'Un componente no existe, está inactivo o no es un producto simple',
          },
        ]
      : [];
  }

  // ---- Alta ------------------------------------------------------------------------------------

  /**
   * Criterios 6 y 30 a 33: crea un producto de cualquier tipo (las reglas del criterio 7 ya las comprobó el
   * esquema). La familia, la estación, los grupos, los componentes y las sucursales deben existir en la
   * empresa y estar activos (422 `REFERENCIA_INVALIDA`, mismo cuerpo para un id de otra empresa y uno
   * inexistente). Queda el último de su familia.
   */
  async crear(entrada: ProductoCrearEntradaValidada): Promise<ProductoRespuesta> {
    const fallan = await validarFamiliaYEstacion(this.conexion, {
      familiaId: entrada.familiaId,
      estacionId: entrada.estacionId ?? null,
    });
    // Sucursales donde el producto nace no disponible (criterio 23): deben existir en la empresa (422, mismo
    // cuerpo para una de otra empresa y una inexistente) y, después, quien crea debe poder ajustarlas
    // (403, criterio 19b). Sin repetidas.
    const noDisponibleEn = [
      ...new Set((entrada.noDisponibleEn ?? []).map((id) => id.toLowerCase())),
    ];
    if (noDisponibleEn.length > 0 && !(await this.sucursales.existen(noDisponibleEn))) {
      fallan.push({
        campo: 'noDisponibleEn',
        mensaje: 'Una de las sucursales no existe',
      });
    }
    const grupos = (entrada.gruposModificadores ?? []).map((id) => id.toLowerCase());
    fallan.push(...(await this.gruposNoAsignables(grupos)));
    const componentes = (entrada.componentes ?? []).map((c) => ({
      productoId: c.productoId.toLowerCase(),
      cantidad: c.cantidad,
    }));
    fallan.push(...(await this.componentesNoAgregables(componentes.map((c) => c.productoId))));
    if (fallan.length > 0) throw referenciaInvalida(fallan);
    await this.permisos.exigirAjustarSucursales(noDisponibleEn);

    const empresaId = this.contexto.empresaActual();
    const ahora = this.reloj.ahora();
    const precio = aDosDecimales(entrada.precio);
    let id: string;
    try {
      const filas = await this.conexion.query<{ id: string }>(
        `INSERT INTO producto (empresa_id, familia_id, tipo, nombre, descripcion, precio, se_vende_solo,
                               afectacion_igv, aplica_icbper, estacion_id, tipo_control_stock, orden,
                               activo, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 (SELECT coalesce(max(orden), 0) + 1 FROM producto WHERE familia_id = $2),
                 true, $12, $12)
         RETURNING id`,
        {
          bind: [
            empresaId,
            entrada.familiaId,
            entrada.tipo,
            entrada.nombre,
            entrada.descripcion ?? null,
            precio,
            entrada.seVendeSolo,
            entrada.afectacionIgv,
            entrada.aplicaIcbper,
            entrada.estacionId ?? null,
            entrada.tipoControlStock,
            ahora,
          ],
          type: QueryTypes.SELECT,
        },
      );
      id = filas[0]!.id;
      await this.escribirGrupos(id, grupos, ahora);
      if (componentes.length > 0) await this.escribirComponentes(id, componentes, ahora);
      if (noDisponibleEn.length > 0) {
        await this.conexion.query(
          `INSERT INTO producto_sucursal (empresa_id, producto_id, sucursal_id, precio, disponible,
                                          creado_en, actualizado_en)
           SELECT $1, $2, s, NULL, false, $4, $4 FROM unnest($3::uuid[]) AS s`,
          { bind: [empresaId, id, noDisponibleEn, ahora] },
        );
      }
    } catch (error) {
      throw this.traducir(error);
    }
    await this.auditoria.registrar({
      accion: 'crear_producto',
      entidad: 'producto',
      entidadId: id,
      detalle: {
        tipo: entrada.tipo,
        nombre: entrada.nombre,
        descripcion: entrada.descripcion ?? null,
        familiaId: entrada.familiaId,
        precio,
        seVendeSolo: entrada.seVendeSolo,
        afectacionIgv: entrada.afectacionIgv,
        aplicaIcbper: entrada.aplicaIcbper,
        estacionId: entrada.estacionId ?? null,
        tipoControlStock: entrada.tipoControlStock,
        ...(grupos.length > 0 ? { gruposModificadores: grupos } : {}),
        ...(componentes.length > 0 ? { componentes } : {}),
        ...(noDisponibleEn.length > 0 ? { noDisponibleEn } : {}),
      },
    });
    this.eventos.cartaActualizada(null);
    return this.obtener(id);
  }

  // ---- Edición ---------------------------------------------------------------------------------

  /**
   * Criterios 10, 10b a 10d y 11: edita el producto (datos, grupos, componentes y tipo), también para
   * desactivarlo (`activo: false`) o reactivarlo. Las reglas del criterio 7 se comprueban sobre el resultado de
   * mezclar lo guardado con lo enviado. Orden de los rechazos: 400 de forma (el esquema), 404, 422
   * `REFERENCIA_INVALIDA`, 400 de las reglas, 409 `EN_USO` (criterio 10c), 409 `CONFLICTO` (criterio 10d) y, al
   * final, 409 `CONFIRMACION_REQUERIDA` (criterio 10b); un nombre repetido (409) sale al escribir. Un `PATCH`
   * que no cambia nada responde 200 sin auditoría ni evento.
   */
  async modificar(id: string, cambios: ProductoModificarEntrada): Promise<ProductoRespuesta> {
    await this.bloquearEnOrden(id, cambios);
    const filas = await this.conexion.query<FilaProducto>(
      `SELECT ${COLUMNAS} FROM producto p WHERE p.id = $1 FOR UPDATE`,
      { bind: [id], type: QueryTypes.SELECT },
    );
    const guardado = filas[0];
    if (guardado === undefined) throw noEncontrado('El producto');

    const antes = estadoDe(guardado);
    const tipo = cambios.tipo ?? antes.tipo;
    const cambiaTipo = tipo !== antes.tipo;
    const aSimple = cambiaTipo && tipo === 'SIMPLE';
    const despues: EstadoProducto = {
      tipo,
      nombre: cambios.nombre ?? antes.nombre,
      descripcion: cambios.descripcion !== undefined ? cambios.descripcion : antes.descripcion,
      familiaId: (cambios.familiaId ?? antes.familiaId).toLowerCase(),
      precio: cambios.precio !== undefined ? aDosDecimales(cambios.precio) : antes.precio,
      // Un combo o un menú se vende solo y no tiene estación propia (criterio 10b): al pasar a uno de ellos
      // el producto queda así, y lo enviado en contra no cumple las reglas del criterio 7 (400).
      seVendeSolo: cambios.seVendeSolo ?? (tipo === 'SIMPLE' ? antes.seVendeSolo : true),
      afectacionIgv: cambios.afectacionIgv ?? antes.afectacionIgv,
      aplicaIcbper: cambios.aplicaIcbper ?? antes.aplicaIcbper,
      estacionId:
        cambios.estacionId !== undefined
          ? (cambios.estacionId?.toLowerCase() ?? null)
          : tipo === 'SIMPLE'
            ? antes.estacionId
            : null,
      tipoControlStock: cambios.tipoControlStock ?? antes.tipoControlStock,
      activo: cambios.activo ?? antes.activo,
    };

    // Referencias (criterio 9): solo las que cambian, y las dos al reactivar un producto, para que un
    // producto activo nunca quede en una familia o con una estación inactivas.
    const reactiva = !antes.activo && despues.activo;
    const cambiaFamilia = despues.familiaId !== antes.familiaId;
    const cambiaEstacion = despues.estacionId !== antes.estacionId;
    const fallan = await validarFamiliaYEstacion(this.conexion, {
      familiaId: cambiaFamilia || reactiva ? despues.familiaId : undefined,
      estacionId: cambiaEstacion || reactiva ? despues.estacionId : undefined,
    });
    // Grupos (criterios 8 y 9): la lista enviada reemplaza a la guardada; solo los que se agregan deben estar
    // activos (los que ya tenía se conservan), y todos al reactivar el producto.
    const gruposAntes =
      cambios.gruposModificadores !== undefined || reactiva
        ? (await this.gruposDe(id)).map((g) => g.id)
        : [];
    const gruposDespues = cambios.gruposModificadores?.map((g) => g.toLowerCase()) ?? gruposAntes;
    const guardadosGrupos = new Set(gruposAntes);
    fallan.push(
      ...(await this.gruposNoAsignables(
        gruposDespues.filter((g) => reactiva || !guardadosGrupos.has(g)),
      )),
    );
    // Componentes (criterios 9 y 32): los guardados se conservan aunque se hayan desactivado (criterio 11);
    // los que se agregan deben ser simples y activos, y no el propio producto. Un `SIMPLE` no los admite (400
    // de las reglas, más abajo), así que ahí no se miran.
    const componentesAntes =
      cambios.componentes !== undefined || cambiaTipo || antes.tipo !== 'SIMPLE'
        ? await this.componentesDe(id)
        : [];
    const componentesEnviados = cambios.componentes?.map((c) => ({
      productoId: c.productoId.toLowerCase(),
      cantidad: c.cantidad,
    }));
    const componentesDespues: { productoId: string; cantidad: number }[] =
      tipo === 'SIMPLE'
        ? []
        : (componentesEnviados ??
          componentesAntes.map((c) => ({ productoId: c.productoId, cantidad: c.cantidad })));
    if (tipo !== 'SIMPLE' && componentesEnviados !== undefined) {
      const conocidos = new Set(componentesAntes.map((c) => c.productoId));
      fallan.push(
        ...(await this.componentesNoAgregables(
          componentesEnviados.map((c) => c.productoId).filter((p) => p === id || !conocidos.has(p)),
          id,
        )),
      );
    }
    if (fallan.length > 0) throw referenciaInvalida(fallan);

    const reglas = reglasDelTipo({
      tipo,
      seVendeSolo: despues.seVendeSolo,
      precio: despues.precio,
      estacionId: despues.estacionId,
      componentes: componentesDespues.length,
      grupos: gruposDespues.length,
      componentesEnviados: cambios.componentes?.length ?? 0,
      faltaEstacion: aSimple && cambios.estacionId === undefined,
    });
    if (reglas.length > 0) throw datosInvalidos(reglas);

    // 409 `EN_USO` (criterio 10c): un producto que es componente de un combo o producto ligado de un
    // modificador activo no puede pasar a combo ni a menú. Con `FOR UPDATE` en el producto, quien lo agregue
    // a un combo o a un modificador después (lo lee `FOR SHARE`) espera y ve el tipo nuevo.
    if (cambiaTipo && antes.tipo === 'SIMPLE' && tipo !== 'SIMPLE') {
      const usadoEn = await usadoEnDe(this.conexion, id);
      if (seUsa(usadoEn)) throw enUsoPorCambioDeTipo(mensajeEnUso(usadoEn, tipo), usadoEn);
    }
    // 409 `CONFLICTO` (criterio 10d).
    if (!despues.seVendeSolo) await this.exigirSinPreciosDeSucursal(id);
    // 409 `CONFIRMACION_REQUERIDA` (criterio 10b): al final, para que nada se pida confirmar si otro rechazo
    // lo impide.
    if (cambiaTipo) {
      const seQuita = await calcularSeQuita(
        { conexion: this.conexion, sucursales: this.sucursales, reloj: this.reloj },
        {
          productoId: id,
          desde: antes.tipo,
          hacia: tipo,
          estacionId: antes.estacionId,
          componentes: componentesAntes,
        },
      );
      if (hayQueQuitar(seQuita) && cambios.confirmarPerdida !== true) {
        throw confirmacionRequerida(mensajeDeConfirmacion(seQuita), seQuita);
      }
    }

    const diff: Record<string, Cambio> = diferencias(antes, despues, CAMPOS_AUDITADOS);
    const cambiaGrupos =
      cambios.gruposModificadores !== undefined && !sinCambioDeOrden(gruposAntes, gruposDespues);
    if (cambiaGrupos) diff.gruposModificadores = { antes: gruposAntes, despues: gruposDespues };
    const listaAntes = componentesAntes.map((c) => `${c.productoId}:${c.cantidad}`);
    const listaDespues = componentesDespues.map((c) => `${c.productoId}:${c.cantidad}`);
    const cambiaComponentes = !sinCambioDeOrden(listaAntes, listaDespues);
    if (cambiaComponentes) {
      diff.componentes = {
        antes: componentesAntes.map((c) => ({ productoId: c.productoId, cantidad: c.cantidad })),
        despues: componentesDespues,
      };
    }
    if (Object.keys(diff).length === 0) return this.obtener(id);

    const ahora = this.reloj.ahora();
    const quitado: Record<string, unknown> = {};
    try {
      await this.conexion.query(
        `UPDATE producto SET tipo = $14, nombre = $2, descripcion = $3, familia_id = $4, precio = $5,
                se_vende_solo = $6, afectacion_igv = $7, aplica_icbper = $8, estacion_id = $9,
                tipo_control_stock = $10, activo = $11, actualizado_en = $12,
                orden = CASE WHEN $13::boolean
                  THEN (SELECT coalesce(max(orden), 0) + 1 FROM producto WHERE familia_id = $4)
                  ELSE orden END
          WHERE id = $1`,
        {
          bind: [
            id,
            despues.nombre,
            despues.descripcion,
            despues.familiaId,
            despues.precio,
            despues.seVendeSolo,
            despues.afectacionIgv,
            despues.aplicaIcbper,
            despues.estacionId,
            despues.tipoControlStock,
            despues.activo,
            ahora,
            cambiaFamilia, // un producto que cambia de familia queda el último de la nueva (criterio 13)
            despues.tipo,
          ],
        },
      );
      if (cambiaGrupos) await this.escribirGrupos(id, gruposDespues, ahora);
      if (cambiaComponentes) await this.escribirComponentes(id, componentesDespues, ahora);
      if (cambiaTipo) {
        // Lo que deja de aplicar se borra, no se conserva desactivado (criterio 10b): las ventas guardan su
        // propia copia y no queda nada oculto que reaparezca al volver al tipo anterior.
        if (antes.tipo === 'SIMPLE' && tipo !== 'SIMPLE' && antes.estacionId !== null) {
          const estacion = await this.conexion.query<{ id: string; nombre: string }>(
            'SELECT id, nombre FROM estacion WHERE id = $1',
            { bind: [antes.estacionId], type: QueryTypes.SELECT },
          );
          quitado.estacion = estacion[0] ?? { id: antes.estacionId, nombre: null };
        }
        if (aSimple && componentesAntes.length > 0) quitado.componentes = componentesAntes;
        if (antes.tipo === 'MENU_DEL_DIA' && tipo !== 'MENU_DEL_DIA') {
          const borradas = await borrarOpcionesDelDia(this.conexion, id);
          if (borradas.length > 0) quitado.opcionesDelDia = borradas;
        }
      }
    } catch (error) {
      throw this.traducir(error);
    }
    await this.auditoria.registrar({
      accion: 'modificar_producto',
      entidad: 'producto',
      entidadId: id,
      detalle: Object.keys(quitado).length > 0 ? { ...diff, quitado } : diff,
    });
    this.eventos.cartaActualizada(null);
    return this.obtener(id);
  }

  /**
   * Bloquea, antes del producto, lo que el `PATCH` va a validar y que debe tomarse antes (orden de bloqueo:
   * familia, grupos y producto; ver la descripción de la clase). Quien cambia un grupo (`GruposService`)
   * bloquea el grupo y luego sus productos ligados `FOR SHARE`; si este `PATCH` tomara primero el producto
   * `FOR UPDATE` y después el grupo `FOR SHARE`, dos peticiones que se esperen entre sí (un producto que es
   * el ligado de un grupo que se le asigna) formarían un abrazo mortal. Lo mismo vale para la familia, que
   * `ordenarDeFamilia` bloquea antes que sus productos. Las lecturas previas no bloquean; si el producto no
   * existe no se bloquea nada y el 404 sale al leerlo.
   */
  private async bloquearEnOrden(id: string, cambios: ProductoModificarEntrada): Promise<void> {
    const previo = (
      await this.conexion.query<{ familia_id: string; activo: boolean }>(
        'SELECT familia_id, activo FROM producto WHERE id = $1',
        { bind: [id], type: QueryTypes.SELECT },
      )
    )[0];
    if (previo === undefined) return;
    const reactiva = cambios.activo === true && !previo.activo;
    const familiaDestino = cambios.familiaId?.toLowerCase();
    if (reactiva || (familiaDestino !== undefined && familiaDestino !== previo.familia_id)) {
      await this.conexion.query('SELECT id FROM familia WHERE id = $1 FOR UPDATE', {
        bind: [familiaDestino ?? previo.familia_id],
        type: QueryTypes.SELECT,
      });
    }
    const grupos = new Set((cambios.gruposModificadores ?? []).map((g) => g.toLowerCase()));
    if (reactiva) for (const g of await this.gruposDe(id)) grupos.add(g.id);
    if (grupos.size > 0) {
      await this.conexion.query(
        'SELECT id FROM grupo_modificadores WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE',
        { bind: [[...grupos]], type: QueryTypes.SELECT },
      );
    }
  }

  // ---- Orden -----------------------------------------------------------------------------------

  /**
   * Criterio 13: `ids` debe contener exactamente una vez cada producto de la familia (activos e inactivos);
   * si no, 400 con el mismo cuerpo. Una familia de otra empresa responde 404 igual que una inexistente. La
   * familia y sus productos se bloquean `FOR UPDATE`: dos ordenamientos, o un alta de producto, se serializan.
   */
  async ordenarDeFamilia(familiaId: string, entrada: OrdenEntrada): Promise<ProductoResumen[]> {
    const familias = await this.conexion.query<{ id: string }>(
      'SELECT id FROM familia WHERE id = $1 FOR UPDATE',
      { bind: [familiaId], type: QueryTypes.SELECT },
    );
    if (familias[0] === undefined) throw noEncontrado('La familia');
    await this.conexion.query(
      'SELECT id FROM producto WHERE familia_id = $1 ORDER BY id FOR UPDATE',
      { bind: [familiaId], type: QueryTypes.SELECT },
    );
    const filas = await this.conexion.query<{ id: string }>(
      'SELECT id FROM producto WHERE familia_id = $1 ORDER BY orden, id',
      { bind: [familiaId], type: QueryTypes.SELECT },
    );
    const actuales = filas.map((f) => f.id);
    const pedidos = entrada.ids.map((x) => x.toLowerCase());
    const conocidos = new Set(actuales);
    if (pedidos.length !== actuales.length || !pedidos.every((x) => conocidos.has(x))) {
      throw ordenInvalido();
    }
    if (!sinCambioDeOrden(actuales, pedidos)) {
      await this.conexion.query(
        `UPDATE producto SET orden = v.posicion, actualizado_en = $2
           FROM unnest($1::uuid[]) WITH ORDINALITY AS v(id, posicion)
          WHERE producto.id = v.id AND producto.orden <> v.posicion`,
        { bind: [pedidos, this.reloj.ahora()] },
      );
      await this.auditoria.registrar({
        accion: 'ordenar_productos',
        entidad: 'producto',
        detalle: { familiaId, antes: actuales, despues: pedidos },
      });
      this.eventos.cartaActualizada(null);
    }
    const ordenados = await this.conexion.query<FilaProducto>(
      `SELECT ${COLUMNAS} FROM producto p WHERE p.familia_id = $1 ORDER BY p.orden, p.id`,
      { bind: [familiaId], type: QueryTypes.SELECT },
    );
    return ordenados.map((f) => this.aResumen(f));
  }

  // ---- Reglas ----------------------------------------------------------------------------------

  /**
   * Criterio 10d: un producto que deja de venderse solo no puede tener precio propio en ninguna sucursal
   * (los precios de sucursal los quita cada quien con su permiso, criterio 19b; no se borran de paso). El
   * producto está bloqueado `FOR UPDATE`, así que un ajuste concurrente (`FOR NO KEY UPDATE`) espera y ve el
   * estado nuevo.
   */
  private async exigirSinPreciosDeSucursal(productoId: string): Promise<void> {
    const filas = await this.conexion.query<{ sucursal_id: string }>(
      'SELECT sucursal_id FROM producto_sucursal WHERE producto_id = $1 AND precio IS NOT NULL',
      { bind: [productoId], type: QueryTypes.SELECT },
    );
    if (filas.length === 0) return;
    const nombres = (await this.sucursales.listar(filas.map((f) => f.sucursal_id))).map(
      (s) => s.nombre,
    );
    throw conflicto(
      `El producto tiene precio propio en: ${nombres.join(', ')}. Quita esos precios antes de dejar de venderlo solo`,
      [{ campo: 'seVendeSolo', mensaje: 'Tiene precio propio en alguna sucursal' }],
    );
  }

  /** 23505 sobre el nombre → 409; 23503 que escapó a la validación previa (una carrera) → 422. */
  private traducir(error: unknown): unknown {
    switch (sqlstateDe(error)) {
      case SQLSTATE.VIOLACION_UNICIDAD:
        return nombreRepetido('un producto');
      case SQLSTATE.VIOLACION_LLAVE_FORANEA: {
        const restriccion = restriccionDe(error) ?? '';
        if (restriccion.includes('componente')) {
          return referenciaInvalida([
            {
              campo: 'componentes',
              mensaje: 'Un componente no existe, está inactivo o no es un producto simple',
            },
          ]);
        }
        if (restriccion.includes('grupo')) {
          return referenciaInvalida([
            {
              campo: 'gruposModificadores',
              mensaje: 'Uno de los grupos no existe o está inactivo',
            },
          ]);
        }
        const campo = restriccion.includes('estacion') ? 'estacionId' : 'familiaId';
        return referenciaInvalida([
          {
            campo,
            mensaje:
              campo === 'estacionId'
                ? 'La estación no existe o está inactiva'
                : 'La familia no existe o está inactiva',
          },
        ]);
      }
      default:
        return error;
    }
  }
}
