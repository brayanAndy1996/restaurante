import { Inject, Injectable } from '@nestjs/common';
import {
  estadoLlamadoPublicoSchema,
  mesaPublicaSchema,
  type EstadoLlamadoPublico,
  type LlamadoDetalle,
  type LlamadosRespuesta,
  type MesaPublica,
} from '@restaurante/contratos';
import {
  aceptaLlamados,
  diaOperativo,
  estadoVigenteLlamado,
  type EstadoLlamado,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { ContextoPublico, cartaNoDisponible } from '../carta-web';
import { PedidosConsultaService } from '../pedidos';
import { SucursalesConsultaService } from '../plataforma';
import { SesionActual } from '../seguridad';
import { llamadoNoEncontrado } from './errores-llamados';
import { COLUMNAS_LLAMADO, leerLlamado, type FilaLlamado } from './filas-llamado';
import { PresentacionLlamados } from './presentacion-llamados';
import { ResolucionMesa } from './resolucion-mesa';

/** `uuid` en cualquier caja, como lo manda el navegador. */
const FORMA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lecturas de los llamados (historia 005, criterios 25, 38, 39 y 40): la mesa pública, el estado para el cliente,
 * la lista del mozo y el detalle con la revisión. El vencimiento se calcula al leer con el reloj de la API
 * (criterio 54).
 */
@Injectable()
export class VistaLlamadosService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoPublico) private readonly publico: ContextoPublico,
    @Inject(ResolucionMesa) private readonly mesas: ResolucionMesa,
    @Inject(PedidosConsultaService) private readonly pedidos: PedidosConsultaService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(PresentacionLlamados) private readonly presentacion: PresentacionLlamados,
  ) {}

  /**
   * `GET /publico/mesas/:codigo` (criterio 25): el nombre de la mesa, las direcciones de su carta, si acepta llamados
   * (horario, criterio 35) y el llamado pendiente vigente. No dice si la mesa está ocupada, ni el mozo, la cuenta o
   * lo consumido (pregunta 2).
   */
  async mesaPublica(codigo: string): Promise<MesaPublica> {
    return this.publico.porCodigoDeMesa(codigo, async () => {
      const mesa = await this.mesas.resolver(codigo);
      const ahora = this.reloj.ahora();
      const datos = await this.sucursales.datosPublicos([mesa.sucursalId]);
      const ordenes = await this.pedidos.ordenesVigentesDeMesas([mesa.mesaId]);
      const pendientes = await this.conexion.query<{
        tipo: 'PEDIDO' | 'LLAMAR_MOZO' | 'PEDIR_CUENTA';
        vence_en: Date;
      }>(`SELECT tipo, vence_en FROM llamado WHERE mesa_id = $1 AND estado = 'PENDIENTE'`, {
        bind: [mesa.mesaId],
        type: QueryTypes.SELECT,
      });
      const horario = datos.get(mesa.sucursalId)?.horario ?? [];
      const acepta = aceptaLlamados({ horario, ahora, mesaConCuenta: ordenes.has(mesa.mesaId) });
      const pendiente = pendientes.find(
        (p) =>
          estadoVigenteLlamado({ estado: 'PENDIENTE', venceEn: new Date(p.vence_en) }, ahora) ===
          'PENDIENTE',
      );
      return mesaPublicaSchema.parse({
        mesa: { nombre: mesa.mesaNombre },
        carta: { empresaSlug: mesa.empresaSlug, sucursalSlug: mesa.sucursalSlug },
        aceptaLlamados: acepta,
        motivoNoAcepta: acepta ? null : 'FUERA_DE_HORARIO',
        llamadoPendiente:
          pendiente === undefined
            ? null
            : { tipo: pendiente.tipo, venceEn: new Date(pendiente.vence_en).toISOString() },
      });
    });
  }

  /**
   * `GET /publico/mesas/:codigo/llamados/:id` (criterio 38): el estado vigente (`VENCIDO` si está `PENDIENTE` y ya
   * pasó `venceEn`), sin nombres de personas. Un llamado de otra mesa (aunque sea de la misma sucursal), de otra
   * empresa o inexistente, o un código reemplazado, responde el mismo 404 de siempre.
   */
  async estadoPublico(codigo: string, llamadoId: string): Promise<EstadoLlamadoPublico> {
    if (typeof llamadoId !== 'string' || !FORMA_UUID.test(llamadoId)) throw cartaNoDisponible();
    return this.publico.porCodigoDeMesa(codigo, async () => {
      const mesa = await this.mesas.resolver(codigo);
      const ahora = this.reloj.ahora();
      const filas = await this.conexion.query<{
        id: string;
        tipo: 'PEDIDO' | 'LLAMAR_MOZO' | 'PEDIR_CUENTA';
        estado: EstadoLlamado;
        vence_en: Date;
      }>(`SELECT id, tipo, estado, vence_en FROM llamado WHERE id = $1 AND mesa_id = $2`, {
        bind: [llamadoId.toLowerCase(), mesa.mesaId],
        type: QueryTypes.SELECT,
      });
      const fila = filas[0];
      if (fila === undefined) throw cartaNoDisponible();
      const venceEn = new Date(fila.vence_en);
      return estadoLlamadoPublicoSchema.parse({
        id: fila.id,
        tipo: fila.tipo,
        estado: estadoVigenteLlamado({ estado: fila.estado, venceEn }, ahora),
        venceEn: venceEn.toISOString(),
      });
    });
  }

  /**
   * `GET /llamados` (criterio 39), de la sucursal activa: los `PENDIENTE` vigentes (`venceEn` después de `ahora`, con el
   * reloj de la API como parámetro, nunca `now()` de la base), los `PEDIDO` `ATENDIDO` sin cerrar del día operativo y
   * los recientes (pasados, descartados o vencidos en los últimos 60 minutos, hasta 30). Pendientes primero y del más
   * antiguo al más nuevo; después los atendidos; al final los recientes, del más nuevo al más viejo. Un número fijo de
   * consultas (hora de corte, activos, recientes y los nombres de las mesas y de las personas), sin importar
   * cuántos llamados haya. `paraEtag` es la respuesta sin `ahora`, que cambia en cada petición.
   */
  async lista(): Promise<{
    respuesta: LlamadosRespuesta;
    paraEtag: Omit<LlamadosRespuesta, 'ahora'>;
  }> {
    const sucursalId = this.sesion.sucursalActiva();
    const ahora = this.reloj.ahora();
    const horaCorte = (await this.sucursales.horaCorte(sucursalId)) ?? '00:00';
    const inicioDelDia = inicioDeDiaOperativo(ahora, horaCorte);
    const desde = new Date(ahora.getTime() - MINUTOS_DE_RECIENTES * MS_POR_MINUTO);

    const activos = await this.conexion.query<FilaLlamado>(
      `SELECT ${COLUMNAS_LLAMADO} FROM llamado l
        WHERE l.sucursal_id = $1
          AND ((l.estado = 'PENDIENTE' AND l.vence_en > $2)
               OR (l.estado = 'ATENDIDO' AND l.tipo = 'PEDIDO' AND l.creado_en >= $3))
        ORDER BY (l.estado = 'PENDIENTE') DESC, l.creado_en, l.id`,
      { bind: [sucursalId, ahora, inicioDelDia], type: QueryTypes.SELECT },
    );
    const recientes = await this.conexion.query<FilaLlamado>(
      `SELECT ${COLUMNAS_LLAMADO} FROM llamado l
        WHERE l.sucursal_id = $1
          AND ((l.estado IN ('PASADO_A_CUENTA', 'DESCARTADO') AND l.cerrado_en > $3 AND l.cerrado_en <= $2)
               OR (l.estado = 'VENCIDO' AND l.vencido_en > $3 AND l.vencido_en <= $2)
               OR (l.estado = 'PENDIENTE' AND l.vence_en <= $2 AND l.vence_en > $3))
        ORDER BY coalesce(l.cerrado_en, l.vencido_en, l.vence_en) DESC, l.id
        LIMIT ${MAXIMO_RECIENTES}`,
      { bind: [sucursalId, ahora, desde], type: QueryTypes.SELECT },
    );
    const llamados = await this.presentacion.resumenes([...activos, ...recientes], ahora);
    return {
      respuesta: { ahora: ahora.toISOString(), llamados },
      paraEtag: { llamados },
    };
  }

  /**
   * `GET /llamados/:id` (criterio 40): el llamado con la revisión de cada línea (precio y disponibilidad de hoy). Uno de
   * otra sucursal, de otra empresa o inexistente, 404 con el mismo cuerpo.
   */
  async detalle(llamadoId: string): Promise<LlamadoDetalle> {
    const fila = await leerLlamado(this.conexion, llamadoId, this.sesion.sucursalActiva(), false);
    if (fila === undefined) throw llamadoNoEncontrado();
    return this.presentacion.detalle(fila, this.reloj.ahora());
  }
}

const MS_POR_MINUTO = 60_000;
/** Los recientes de la lista duran una hora y son hasta 30 (criterio 39). */
const MINUTOS_DE_RECIENTES = 60;
const MAXIMO_RECIENTES = 30;

/**
 * Inicio del día operativo de `ahora`: la hora de corte del día de Lima que `diaOperativo` calcula. Perú no tiene
 * horario de verano, así que el desplazamiento fijo de Lima (-05:00) es exacto.
 */
function inicioDeDiaOperativo(ahora: Date, horaCorte: string): Date {
  return new Date(`${diaOperativo(ahora, horaCorte)}T${horaCorte}:00-05:00`);
}
