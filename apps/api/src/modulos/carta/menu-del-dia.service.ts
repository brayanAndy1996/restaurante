import { Inject, Injectable } from '@nestjs/common';
import type {
  MenuDelDiaConsulta,
  MenuDelDiaEntrada,
  MenuDelDiaRespuesta,
} from '@restaurante/contratos';
import { diaOperativo, precioEfectivo, type HastaAgotado } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { SucursalesConsultaService } from '../plataforma';
import { SesionActual } from '../seguridad';
import { productoDisponible } from './disponibilidad-carta';
import { datosInvalidos, noEncontrado, referenciaInvalida } from './errores-carta';
import { EventosCarta } from './eventos-carta';
import { sinCambioDeOrden, sumarDias } from './util-carta';

interface FilaMenu {
  id: string;
  nombre: string;
  precio: string | null;
  precio_sucursal: string | null;
}

interface FilaOpcion {
  producto_id: string;
  grupo_id: string;
  grupo_nombre: string;
  minimo: number;
  maximo: number;
  modificador_id: string;
  nombre: string;
  precio_extra: string;
  ligado_id: string | null;
  ligado_nombre: string | null;
  ligado_activo: boolean | null;
  ligado_en_sucursal: boolean | null;
  ligado_agotado_dia: string | null;
  ligado_agotado_hasta: HastaAgotado | null;
}

/** El día y el menú sobre los que se trabaja: la sucursal activa y su día operativo actual. */
interface Contexto {
  sucursalId: string;
  hoy: string;
}

/**
 * Menú del día de la sucursal activa (HU-08, RF-18, criterios 34 a 38). Un `MENU_DEL_DIA` se configura como un
 * combo (precio, componentes y grupos, uno por tiempo, cuyos modificadores son los platos candidatos); cada
 * día, en cada sucursal, Cocina/Barra, el Supervisor o el Administrador eligen cuáles candidatos se ofrecen:
 * las opciones del día (`menu_del_dia_opcion`). El día operativo se calcula con el reloj de la API y la hora de
 * corte de la sucursal, nunca con `now()` de la base. Las opciones de un día solo valen ese día: al pasar la
 * hora de corte empieza un día sin opciones.
 *
 * `disponible` de una opción dice si su producto ligado (si lo tiene) está activo, se ofrece en la sucursal y no
 * tiene un agotado vigente: es la misma regla de la vista de la sucursal (`productoDisponible`), evaluada con el
 * día operativo actual aunque se consulte el de ayer o el de mañana.
 */
@Injectable()
export class MenuDelDiaService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(EventosCarta) private readonly eventos: EventosCarta,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(SesionActual) private readonly sesion: SesionActual,
  ) {}

  /** La sucursal activa y su día operativo (la ruta exige sucursal activa: `@RequiereSucursal()`). */
  private async contextoActual(): Promise<Contexto> {
    const sucursalId = this.sesion.principal().sucursalId;
    if (sucursalId === null) throw noEncontrado('La sucursal');
    const horaCorte = await this.sucursales.horaCorte(sucursalId);
    if (horaCorte === null) throw noEncontrado('La sucursal');
    return { sucursalId, hoy: diaOperativo(this.reloj.ahora(), horaCorte) };
  }

  // ---- Consulta --------------------------------------------------------------------------------

  /**
   * Criterio 34: los menús del día activos y disponibles en la sucursal activa, con sus tiempos y platos
   * candidatos y cuáles se ofrecen en `dia`. Se aceptan el día operativo anterior, el actual (por defecto) y el
   * siguiente; otro día responde 400.
   */
  async consultar(consulta: MenuDelDiaConsulta): Promise<MenuDelDiaRespuesta[]> {
    const { sucursalId, hoy } = await this.contextoActual();
    const dia = consulta.dia ?? hoy;
    if (dia < sumarDias(hoy, -1) || dia > sumarDias(hoy, 1)) {
      throw datosInvalidos([
        {
          campo: 'dia',
          mensaje: 'Solo se puede consultar el día anterior, el de hoy o el de mañana',
        },
      ]);
    }
    const menus = await this.conexion.query<FilaMenu>(
      `SELECT p.id, p.nombre, p.precio, ps.precio AS precio_sucursal
         FROM producto p
         JOIN familia f ON f.id = p.familia_id
         LEFT JOIN producto_sucursal ps ON ps.producto_id = p.id AND ps.sucursal_id = $1
        WHERE p.tipo = 'MENU_DEL_DIA' AND p.activo AND coalesce(ps.disponible, true)
        ORDER BY f.orden, f.id, p.orden, p.id`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    return this.construir(sucursalId, dia, hoy, menus);
  }

  /**
   * Arma la respuesta de los menús dados con tres consultas fijas (menús ya leídos, tiempos con sus platos y
   * opciones elegidas), sin importar cuántos menús ni platos haya. `hoy` es el día operativo actual, con el que
   * se evalúa el agotado de cada producto ligado.
   */
  private async construir(
    sucursalId: string,
    dia: string,
    hoy: string,
    menus: readonly FilaMenu[],
  ): Promise<MenuDelDiaRespuesta[]> {
    if (menus.length === 0) return [];
    const ids = menus.map((m) => m.id);
    const opciones = await this.conexion.query<FilaOpcion>(
      `SELECT pg.producto_id, g.id AS grupo_id, g.nombre AS grupo_nombre, g.minimo, g.maximo,
              m.id AS modificador_id, m.nombre, m.precio_extra,
              l.id AS ligado_id, l.nombre AS ligado_nombre, l.activo AS ligado_activo,
              coalesce(pl.disponible, true) AS ligado_en_sucursal,
              al.dia_operativo::text AS ligado_agotado_dia, al.hasta AS ligado_agotado_hasta
         FROM producto_grupo pg
         JOIN grupo_modificadores g ON g.id = pg.grupo_id AND g.activo
         JOIN modificador m ON m.grupo_id = g.id AND m.activo
         LEFT JOIN producto l ON l.id = m.producto_id
         LEFT JOIN producto_sucursal pl ON pl.producto_id = l.id AND pl.sucursal_id = $2
         LEFT JOIN producto_agotado al ON al.producto_id = l.id AND al.sucursal_id = $2
        WHERE pg.producto_id = ANY($1::uuid[])
        ORDER BY pg.producto_id, pg.orden, g.id, m.orden, m.id`,
      { bind: [ids, sucursalId], type: QueryTypes.SELECT },
    );
    const elegidas = await this.conexion.query<{ producto_id: string; modificador_id: string }>(
      `SELECT producto_id, modificador_id FROM menu_del_dia_opcion
        WHERE sucursal_id = $1 AND dia_operativo = $2::date AND producto_id = ANY($3::uuid[])`,
      { bind: [sucursalId, dia, ids], type: QueryTypes.SELECT },
    );
    const elegida = new Set(elegidas.map((e) => `${e.producto_id}|${e.modificador_id}`));
    return menus.map((menu) => {
      const grupos: MenuDelDiaRespuesta['grupos'] = [];
      for (const o of opciones.filter((x) => x.producto_id === menu.id)) {
        let grupo = grupos.find((g) => g.id === o.grupo_id);
        if (grupo === undefined) {
          grupo = {
            id: o.grupo_id,
            nombre: o.grupo_nombre,
            minimo: o.minimo,
            maximo: o.maximo,
            opciones: [],
          };
          grupos.push(grupo);
        }
        grupo.opciones.push({
          modificadorId: o.modificador_id,
          nombre: o.nombre,
          precioExtra: o.precio_extra,
          producto:
            o.ligado_id === null ? null : { id: o.ligado_id, nombre: o.ligado_nombre ?? '' },
          elegida: elegida.has(`${menu.id}|${o.modificador_id}`),
          disponible:
            o.ligado_id === null ||
            productoDisponible(
              {
                activo: o.ligado_activo ?? false,
                disponible: o.ligado_en_sucursal ?? true,
                agotado:
                  o.ligado_agotado_dia === null || o.ligado_agotado_hasta === null
                    ? null
                    : { diaOperativo: o.ligado_agotado_dia, hasta: o.ligado_agotado_hasta },
              },
              hoy,
            ),
        });
      }
      return {
        productoId: menu.id,
        nombre: menu.nombre,
        precio: precioEfectivo(menu.precio, menu.precio_sucursal),
        dia,
        grupos,
      };
    });
  }

  // ---- Armar el día ----------------------------------------------------------------------------

  /**
   * Criterio 35: reemplaza las opciones de `dia` (hoy por defecto, o mañana) del menú en la sucursal activa.
   * Orden de los rechazos: 400 de forma (el esquema), 404 (el producto no existe, es de otra empresa o no es un
   * `MENU_DEL_DIA`), 400 del día, 422 `REFERENCIA_INVALIDA` (una opción que no es un modificador activo de un
   * grupo activo asignado al menú). Repetir la misma lista responde 200 sin auditoría ni evento.
   */
  async armarDia(productoId: string, entrada: MenuDelDiaEntrada): Promise<MenuDelDiaRespuesta> {
    const { sucursalId, hoy } = await this.contextoActual();
    // `FOR NO KEY UPDATE`: serializa dos armados del mismo menú (el antes de la auditoría y el reemplazo son
    // exactos) y un cambio de tipo o una edición del producto (`FOR UPDATE`, que borra las opciones del día),
    // sin bloquear las llaves foráneas.
    const menu = (
      await this.conexion.query<FilaMenu & { tipo: string }>(
        `SELECT p.id, p.nombre, p.precio, ps.precio AS precio_sucursal, p.tipo
           FROM producto p
           LEFT JOIN producto_sucursal ps ON ps.producto_id = p.id AND ps.sucursal_id = $2
          WHERE p.id = $1 FOR NO KEY UPDATE OF p`,
        { bind: [productoId, sucursalId], type: QueryTypes.SELECT },
      )
    )[0];
    if (menu === undefined || menu.tipo !== 'MENU_DEL_DIA') throw noEncontrado('El menú del día');

    const dia = entrada.dia ?? hoy;
    if (dia !== hoy && dia !== sumarDias(hoy, 1)) {
      throw datosInvalidos([
        { campo: 'dia', mensaje: 'Solo se puede armar el menú de hoy o el de mañana' },
      ]);
    }

    const pedidas = [...new Set(entrada.opciones.map((o) => o.toLowerCase()))].sort();
    if (pedidas.length > 0) {
      // Cada opción: un modificador activo de un grupo activo asignado a este menú. `FOR SHARE`: quien lo
      // desactiva (`GruposService`) lo bloquea `FOR UPDATE`.
      const validas = await this.conexion.query<{ id: string }>(
        `SELECT m.id FROM modificador m
           JOIN grupo_modificadores g ON g.id = m.grupo_id AND g.activo
           JOIN producto_grupo pg ON pg.grupo_id = g.id AND pg.producto_id = $1
          WHERE m.id = ANY($2::uuid[]) AND m.activo
          ORDER BY m.id FOR SHARE OF m`,
        { bind: [productoId, pedidas], type: QueryTypes.SELECT },
      );
      if (validas.length !== pedidas.length) {
        throw referenciaInvalida([
          {
            campo: 'opciones',
            mensaje: 'Una de las opciones no existe o no es un plato activo de este menú',
          },
        ]);
      }
    }

    const guardadas = (
      await this.conexion.query<{ modificador_id: string }>(
        `SELECT modificador_id FROM menu_del_dia_opcion
          WHERE sucursal_id = $1 AND producto_id = $2 AND dia_operativo = $3::date
          ORDER BY modificador_id`,
        { bind: [sucursalId, productoId, dia], type: QueryTypes.SELECT },
      )
    ).map((f) => f.modificador_id);

    if (!sinCambioDeOrden(guardadas, pedidas)) {
      const ahora = this.reloj.ahora();
      await this.conexion.query(
        `DELETE FROM menu_del_dia_opcion
          WHERE sucursal_id = $1 AND producto_id = $2 AND dia_operativo = $3::date
            AND modificador_id <> ALL($4::uuid[])`,
        { bind: [sucursalId, productoId, dia, pedidas] },
      );
      if (pedidas.length > 0) {
        await this.conexion.query(
          `INSERT INTO menu_del_dia_opcion (empresa_id, sucursal_id, producto_id, modificador_id,
                                            dia_operativo, creado_en, actualizado_en)
           SELECT $1, $2, $3, m, $5::date, $6, $6 FROM unnest($4::uuid[]) AS m
           ON CONFLICT (sucursal_id, producto_id, dia_operativo, modificador_id) DO NOTHING`,
          {
            bind: [this.contexto.empresaActual(), sucursalId, productoId, pedidas, dia, ahora],
          },
        );
      }
      await this.auditoria.registrar({
        accion: 'armar_menu_del_dia',
        entidad: 'producto',
        entidadId: productoId,
        sucursalId,
        detalle: { dia, opciones: { antes: guardadas, despues: pedidas } },
      });
      this.eventos.cartaActualizada(sucursalId);
    }
    return (await this.construir(sucursalId, dia, hoy, [menu]))[0]!;
  }
}
