import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  pasoACuentaRespuestaSchema,
  type CampoError,
  type LineaParaBorrador,
  type PasoACuentaEntrada,
  type PasoACuentaRespuesta,
} from '@restaurante/contratos';
import { excedeMontoMaximo, siguienteEstadoLlamado, totalOrden } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { jsonCanonico } from '../../nucleo/idempotencia';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { CartaVentaService } from '../carta';
import { PedidosConsultaService } from '../pedidos';
import { SesionActual } from '../seguridad';
import {
  llamadoCerrado,
  llamadoNoEncontrado,
  lineasRechazadas,
  mesaSinCuenta,
  montoFueraDeRango,
  posicionesInvalidas,
  transicionInvalida,
} from './errores-llamados';
import { EventosLlamados } from './eventos-llamados';
import { leerLlamado, type FilaLlamado } from './filas-llamado';
import { esLaMismaPersona } from './persona-de-llamado';
import { PresentacionLlamados, motivoDeNoDisponible } from './presentacion-llamados';

type LineaDelPaso = { posicion: number; cantidad: number };

/** Huella de lo que el mozo pidió pasar: las líneas ordenadas por posición (la misma petición, escrita en otro orden). */
const huellaDelPaso = (lineas: readonly LineaDelPaso[]): Buffer =>
  createHash('sha256').update(jsonCanonico({ lineas }), 'utf8').digest();

/**
 * Pasar un llamado a la cuenta de la mesa (historia 005, criterios 46 a 52; ruta crítica P3). **No toca ninguna tabla
 * de pedidos** —la orden solo se lee con `PedidosConsultaService`— ni usa el servicio de envíos: no crea envío, ítem,
 * comanda ni trabajo de impresión, no llama al inventario, no cambia la versión de la orden ni su pre-cuenta y no publica
 * `cocina.*`, `salon.cambio` ni `orden.cambio`. Las líneas llegan a cocina solo cuando alguien pulsa "Enviar" en el
 * borrador (`POST /ordenes/:id/envios` de 004), que vuelve a validarlas y a calcular su precio.
 *
 * Con el llamado bloqueado (`FOR UPDATE`): réplica natural (el mismo paso, de la misma persona desde cualquier sesión, responde lo guardado);
 * estado y tipo; posiciones; cuenta vigente de la mesa; y las líneas preparadas de nuevo con los precios y la
 * disponibilidad de hoy, todo o nada.
 */
@Injectable()
export class PasoACuentaService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(PedidosConsultaService) private readonly pedidos: PedidosConsultaService,
    @Inject(CartaVentaService) private readonly carta: CartaVentaService,
    @Inject(PresentacionLlamados) private readonly presentacion: PresentacionLlamados,
    @Inject(EventosLlamados) private readonly eventos: EventosLlamados,
  ) {}

  /** `POST /llamados/:id/paso-a-cuenta`: las líneas salen con los precios del sistema, todo o nada. */
  async pasar(llamadoId: string, entrada: PasoACuentaEntrada): Promise<PasoACuentaRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const principal = this.sesion.principal();
    const ahora = this.reloj.ahora();
    const fila = await leerLlamado(this.conexion, llamadoId, sucursalId, true);
    if (fila === undefined) throw llamadoNoEncontrado();

    // Las líneas pedidas en el orden de las posiciones, para la huella y para el borrador.
    const pedidas = entrada.lineas
      .map((linea, indice) => ({ ...linea, indice }))
      .sort((a, b) => a.posicion - b.posicion || a.indice - b.indice);
    const huella = huellaDelPaso(pedidas.map(({ posicion, cantidad }) => ({ posicion, cantidad })));

    // Réplica natural (criterio 51): un llamado ya pasado con las mismas líneas devuelve el paso original, pero solo a
    // la misma persona que lo pasó (su usuario, desde cualquier sesión o equipo; en soporte, la misma sesión). Otra
    // persona no recibe las líneas: 409 `LLAMADO_CERRADO`, como con otras líneas.
    if (fila.estado === 'PASADO_A_CUENTA') {
      const quienPaso = {
        usuarioId: fila.cerrado_por_usuario_id,
        sesionId: fila.cerrado_por_sesion_id,
      };
      if (esLaMismaPersona(principal, quienPaso)) {
        const guardado = await this.respuestaGuardada(fila.id);
        if (guardado !== null && guardado.huella.equals(huella)) return guardado.respuesta;
      }
      throw llamadoCerrado('PASADO_A_CUENTA');
    }
    if (fila.estado === 'DESCARTADO') throw llamadoCerrado('DESCARTADO');
    // Solo un `PEDIDO` `ATENDIDO` (un pendiente, un vencido o un aviso sin pedido no se pasan).
    if (siguienteEstadoLlamado(fila.tipo, fila.estado, 'PASAR_A_CUENTA') === null) {
      throw transicionInvalida();
    }

    this.validarPosiciones(fila, entrada);

    const vigente = (await this.pedidos.ordenesVigentesDeMesas([fila.mesa_id])).get(fila.mesa_id);
    if (vigente === undefined) throw mesaSinCuenta();

    const lineas = await this.prepararLineas(fila, pedidas, ahora);

    // Lo que queda guardado y lo que se responde (la respuesta se guarda para reconocer la réplica).
    const lineasPasadas = pedidas.map(({ posicion, cantidad }) => ({ posicion, cantidad }));
    const pasada: FilaLlamado = {
      ...fila,
      estado: 'PASADO_A_CUENTA',
      orden_id: vigente.ordenId,
      lineas_pasadas: lineasPasadas,
      cerrado_por_usuario_id: principal.usuarioId,
      cerrado_por_equipo_id: principal.equipoId,
      cerrado_por_sesion_id: principal.sesionId,
      cerrado_en: ahora,
    };
    const respuesta = pasoACuentaRespuestaSchema.parse({
      llamado: await this.presentacion.detalle(pasada, ahora),
      ordenId: vigente.ordenId,
      lineas,
    });
    await this.conexion.query(
      `UPDATE llamado
          SET estado = 'PASADO_A_CUENTA', orden_id = $2, lineas_pasadas = $3::jsonb,
              cerrado_por_usuario_id = $4, cerrado_por_equipo_id = $5, cerrado_en = $6,
              respuesta_paso = $7::jsonb, huella_paso = $8, cerrado_por_sesion_id = $9, actualizado_en = $6
        WHERE id = $1`,
      {
        bind: [
          fila.id,
          vigente.ordenId,
          JSON.stringify(lineasPasadas),
          principal.usuarioId,
          principal.equipoId,
          ahora,
          JSON.stringify(respuesta),
          huella,
          principal.sesionId,
        ],
        type: QueryTypes.UPDATE,
      },
    );
    this.eventos.cambio(sucursalId, {
      llamadoId: fila.id,
      mesaId: fila.mesa_id,
      estado: 'PASADO_A_CUENTA',
    });
    return respuesta;
  }

  /** La respuesta del paso original y la huella de lo que se pidió entonces. */
  private async respuestaGuardada(
    llamadoId: string,
  ): Promise<{ respuesta: PasoACuentaRespuesta; huella: Buffer } | null> {
    const filas = await this.conexion.query<{
      respuesta_paso: unknown;
      huella_paso: Buffer | null;
    }>('SELECT respuesta_paso, huella_paso FROM llamado WHERE id = $1', {
      bind: [llamadoId],
      type: QueryTypes.SELECT,
    });
    const guardado = filas[0];
    if (guardado?.respuesta_paso == null || guardado.huella_paso == null) return null;
    return {
      respuesta: pasoACuentaRespuestaSchema.parse(guardado.respuesta_paso),
      huella: guardado.huella_paso,
    };
  }

  /** 422 `DATOS_INVALIDOS` con `campos` si una `posicion` no es de una línea del llamado o se repite (criterio 46). */
  private validarPosiciones(fila: FilaLlamado, entrada: PasoACuentaEntrada): void {
    const campos: CampoError[] = [];
    const vistas = new Set<number>();
    for (const linea of entrada.lineas) {
      if (linea.posicion >= fila.lineas.length) {
        campos.push({
          campo: `lineas.${linea.posicion}`,
          mensaje: 'La posición no es de una línea del llamado',
        });
      } else if (vistas.has(linea.posicion)) {
        campos.push({ campo: `lineas.${linea.posicion}`, mensaje: 'La posición está repetida' });
      }
      vistas.add(linea.posicion);
    }
    if (campos.length > 0) throw posicionesInvalidas(campos);
  }

  /**
   * Cada línea pedida se prepara de nuevo con `prepararLineas` (sucursal del llamado, producto, modificadores y
   * observación del llamado, la cantidad de la entrada, el instante de ahora): los precios y la disponibilidad son los
   * del sistema, no los que vio el cliente (decisión 3). Si alguna se rechaza, 422 con una entrada de `campos` por línea
   * (`lineas.<posición>`, con la posición contando desde 0 en el llamado y el motivo) y nada cambia.
   */
  private async prepararLineas(
    fila: FilaLlamado,
    pedidas: readonly { posicion: number; cantidad: number; indice: number }[],
    ahora: Date,
  ): Promise<LineaParaBorrador[]> {
    const resultados = await this.carta.prepararLineas(
      fila.sucursal_id,
      pedidas.map(({ posicion, cantidad }) => ({
        productoId: fila.lineas[posicion]!.productoId,
        modificadorIds: fila.lineas[posicion]!.modificadorIds,
        cantidad,
      })),
      ahora,
    );
    const rechazos: { codigo: ErrorAplicacion['codigo']; mensaje: string; campo: CampoError }[] =
      [];
    const preparadas: LineaParaBorrador[] = [];
    resultados.forEach((resultado, orden) => {
      const { posicion } = pedidas[orden]!;
      const guardada = fila.lineas[posicion]!;
      if (!resultado.ok) {
        const revision = motivoDeNoDisponible(resultado.error, guardada);
        if (revision.disponible) throw resultado.error;
        rechazos.push({
          codigo: codigoDeRechazo(resultado.error),
          mensaje: revision.motivo,
          campo: {
            campo: `lineas.${posicion}`,
            mensaje: revision.codigo,
          },
        });
        return;
      }
      const linea = resultado.linea;
      preparadas.push({
        posicion,
        productoId: linea.productoId,
        nombre: linea.nombre,
        modificadores: linea.modificadores.map((m) => ({
          id: m.id,
          nombre: m.nombre,
          precioExtra: m.precioExtra,
        })),
        cantidad: linea.cantidad,
        observacion: guardada.observacion,
        precioUnitario: linea.precioUnitario,
        total: linea.total,
      });
    });
    const primero = rechazos[0];
    if (primero !== undefined) {
      throw lineasRechazadas(
        { codigo: primero.codigo, mensaje: primero.mensaje },
        rechazos.map((r) => r.campo),
      );
    }

    // Topes de monto (criterio 27): por línea y del total de lo que se pasa.
    const fuera: CampoError[] = [];
    preparadas.forEach((linea) => {
      if (excedeMontoMaximo(linea.precioUnitario) || excedeMontoMaximo(linea.total)) {
        fuera.push({
          campo: `lineas.${linea.posicion}`,
          mensaje: 'El monto de la línea supera el máximo',
        });
      }
    });
    if (fuera.length > 0) throw montoFueraDeRango(fuera);
    const total = totalOrden(
      preparadas.map((l) => ({
        precioUnitario: l.precioUnitario,
        cantidad: l.cantidad,
        cantidadAnulada: 0,
      })),
    );
    if (excedeMontoMaximo(total)) {
      throw montoFueraDeRango([
        { campo: 'lineas', mensaje: 'El total de lo que se pasa supera el máximo' },
      ]);
    }
    return preparadas;
  }
}

/** El código HTTP-estable del rechazo de `prepararLinea`: `PRODUCTO_NO_VENDIBLE`, `SELECCION_INVALIDA` o `NO_ENCONTRADO`. */
function codigoDeRechazo(error: unknown): ErrorAplicacion['codigo'] {
  if (error instanceof ErrorAplicacion) {
    return error.codigo === 'NO_ENCONTRADO' ? 'PRODUCTO_NO_VENDIBLE' : error.codigo;
  }
  return 'PRODUCTO_NO_VENDIBLE';
}
