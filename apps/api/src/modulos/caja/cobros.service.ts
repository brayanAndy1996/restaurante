import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  CobroEntradaValidada,
  CobroRespuesta,
  CuentaRespuesta,
  CuentaResumen,
} from '@restaurante/contratos';
import {
  MONTO_BOLETA_SIN_DOCUMENTO,
  excedeMontoMaximo,
  type TipoParte,
} from '@restaurante/dominio';
import {
  calcularCuenta,
  calcularParte,
  compararMontos,
  restarMontos,
  sumarMontos,
  validarPagos,
  type CuentaEntrada,
  type ParteEntrada,
  type PagoEntrada,
  type ResultadoParte,
} from '@restaurante/dominio/caja';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { jsonCanonico } from '../../nucleo/idempotencia';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { ComprobantesService, EmisionService, FacturadoService } from '../facturacion';
import { CuentasDePedidos, type CuentaParaCobrar } from '../pedidos';
import { SesionActual, UsuariosConsultaService } from '../seguridad';
import {
  clienteRequerido,
  comprobanteNoPermitido,
  cuentaCambio,
  idDeClienteReutilizado,
  montoFueraDeRango,
  nadaQueCobrar,
  noEncontrado,
  pagosNoCuadran,
  parteInvalida,
  tasaIgvNoConfigurada,
  turnoAjeno,
  turnoCerrado,
} from './errores-caja';
import { EventosCaja } from './eventos-caja';
import { ImpresoraDeCajas } from './impresora-de-cajas';
import { ParametrosDeCuenta, type Parametros } from './parametros-de-cuenta';

const sha256 = (texto: string): Buffer => createHash('sha256').update(texto, 'utf8').digest();

/** Un monto de texto (`"100"`, `"100.5"`) con exactamente 2 decimales. */
function dosDecimales(monto: string): string {
  const [enteros = '0', decimales = ''] = monto.split('.');
  return `${enteros.replace(/^0+(?=\d)/, '')}.${decimales.padEnd(2, '0')}`;
}

/** El cliente del comprobante de la entrada, tal como se compara y se guarda. */
export interface ClienteNormalizado {
  tipoDocumento: 'DNI' | 'CE' | 'PASAPORTE' | 'RUC';
  numero: string;
  nombre: string;
  direccion?: string;
}

/** La entrada de un cobro normalizada: ids en minúsculas y montos con 2 decimales. Es lo que se compara y se guarda. */
export interface EntradaNormalizada {
  ordenId: string;
  turnoId: string;
  total: string;
  parte: CobroRespuesta['parte'];
  comprobante: {
    tipo: 'BOLETA' | 'FACTURA';
    formato: 'DETALLADO' | 'CONSUMO';
    cliente?: ClienteNormalizado;
  };
  pagos: { medio: PagoEntrada['medio']; monto: string; recibido?: string; operacion?: string }[];
  redondeo: string;
}

export function normalizar(ordenId: string, entrada: CobroEntradaValidada): EntradaNormalizada {
  const parte: CobroRespuesta['parte'] =
    entrada.parte.tipo === 'ITEMS'
      ? {
          tipo: 'ITEMS',
          items: entrada.parte.items
            .map((i) => ({ itemId: i.itemId.toLowerCase(), cantidad: i.cantidad }))
            .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)),
        }
      : entrada.parte.tipo === 'IGUALES'
        ? { tipo: 'IGUALES', partesRestantes: entrada.parte.partesRestantes }
        : { tipo: 'TOTAL' };
  const cliente = entrada.comprobante.cliente;
  return {
    ordenId,
    turnoId: entrada.turnoId.toLowerCase(),
    total: dosDecimales(entrada.total),
    parte,
    comprobante: {
      tipo: entrada.comprobante.tipo,
      formato: entrada.comprobante.formato,
      ...(cliente === undefined
        ? {}
        : {
            cliente: {
              tipoDocumento: cliente.tipoDocumento,
              numero: cliente.numero,
              nombre: cliente.nombre,
              ...(cliente.direccion === undefined ? {} : { direccion: cliente.direccion }),
            },
          }),
    },
    pagos: entrada.pagos.map((p) => ({
      medio: p.medio,
      monto: dosDecimales(p.monto),
      ...(p.recibido === undefined ? {} : { recibido: dosDecimales(p.recibido) }),
      ...(p.operacion === undefined ? {} : { operacion: p.operacion }),
    })),
    redondeo: dosDecimales(entrada.redondeo),
  };
}

/**
 * La huella de la entrada para reconocer la réplica por `id` (criterio 55): la orden, el turno, la parte, el
 * comprobante, los pagos y el redondeo. Sin `version` ni `total`: son lo que vio la persona y cambian entre
 * reintentos sin que el cobro sea otro.
 */
function huellaDe(e: EntradaNormalizada): Buffer {
  return sha256(
    jsonCanonico({
      ordenId: e.ordenId,
      turnoId: e.turnoId,
      parte: e.parte,
      comprobante: e.comprobante,
      pagos: e.pagos,
      redondeo: e.redondeo,
    }),
  );
}

/** 422 `MONTO_FUERA_DE_RANGO` si el total, un pago o un recibido pasa de `99999999.99` (criterio 62). */
export function exigirMontosEnRango(e: EntradaNormalizada): void {
  if (excedeMontoMaximo(e.total)) throw montoFueraDeRango('total');
  e.pagos.forEach((p, i) => {
    if (excedeMontoMaximo(p.monto)) throw montoFueraDeRango(`pagos.${i}.monto`);
    if (p.recibido !== undefined && excedeMontoMaximo(p.recibido)) {
      throw montoFueraDeRango(`pagos.${i}.recibido`);
    }
  });
}

export interface FilaTurnoDeCobro {
  id: string;
  caja_id: string;
  responsable_id: string;
  estado: 'ABIERTO' | 'CERRADO';
}

interface FilaReplica {
  orden_id: string;
  sucursal_id: string;
  responsable_id: string;
  huella_entrada: Buffer;
  respuesta: CobroRespuesta;
}

/**
 * Cobro y consulta de la cuenta (historia 006, criterios 36, 37 y 47 a 68; ruta crítica P2): dueño de `cobro` y
 * `pago`. La consulta de la cuenta lee las órdenes por `CuentasDePedidos` (pedidos es dueño de ítems, descuentos y
 * cortesías) y calcula los montos con `calcularCuenta` de `packages/dominio`. El cobro corre en una sola transacción
 * con este orden fijo de bloqueos: orden, turno, serie, cuota; el servidor recalcula todo con `packages/dominio` y
 * emite el comprobante con `EmisionService`. Una réplica por `id` devuelve la respuesta guardada sin efectos.
 */
@Injectable()
export class CobrosService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(CuentasDePedidos) private readonly cuentas: CuentasDePedidos,
    @Inject(ParametrosDeCuenta) private readonly parametros: ParametrosDeCuenta,
    @Inject(FacturadoService) private readonly facturado: FacturadoService,
    @Inject(EmisionService) private readonly emision: EmisionService,
    @Inject(ComprobantesService) private readonly comprobantes: ComprobantesService,
    @Inject(UsuariosConsultaService) private readonly usuarios: UsuariosConsultaService,
    @Inject(ImpresoraDeCajas) private readonly impresoras: ImpresoraDeCajas,
    @Inject(EventosCaja) private readonly eventos: EventosCaja,
  ) {}

  /** `GET /cuentas/:ordenId`: la cuenta con sus montos de `calcularCuenta` (criterio 36). */
  async cuenta(ordenId: string): Promise<CuentaRespuesta> {
    const cuenta = await this.cuentas.cuentaParaCobrar(ordenId, {
      bloquear: false,
      soloAbiertas: false,
    });
    const parametros = await this.parametros.de(cuenta.sucursalId);
    const calculada = calcularCuenta(entradaDeCalculo(cuenta, parametros));
    return {
      ordenId: cuenta.ordenId,
      tipo: cuenta.tipo,
      estado: cuenta.estado,
      mesas: cuenta.mesas,
      mozo: cuenta.mozo,
      numeroLlamado: cuenta.numeroLlamado,
      version: cuenta.version,
      lineas: cuenta.lineas.map((l, i) => {
        const c = calculada.lineas[i]!;
        return {
          itemId: l.itemId,
          nombre: l.nombre,
          modificadores: l.modificadores,
          precioUnitario: l.precioUnitario,
          cantidad: l.cantidad,
          cantidadCortesia: l.cantidadCortesia,
          cantidadFacturada: l.cantidadFacturada,
          afectacion: l.afectacion,
          aplicaIcbper: l.aplicaIcbper,
          bruto: c.bruto,
          descuento: l.descuento,
          descuentoCuenta: c.descuentoCuenta,
          neto: c.neto,
          icbper: c.icbper,
        };
      }),
      descuentoCuenta: cuenta.descuentoCuenta,
      cortesias: cuenta.cortesias,
      totales: calculada.totales,
      cobrado: cuenta.cobrado,
      saldo: restarMontos(calculada.totales.total, cuenta.cobrado),
      modo: cuenta.modo,
      cobros: await this.cobrosDe(cuenta.ordenId),
      parametros,
    };
  }

  /** `GET /cuentas`: las órdenes abiertas de la sucursal activa, de la más antigua a la más nueva (criterio 37). */
  async cuentasPorCobrar(): Promise<CuentaResumen[]> {
    const abiertas = await this.cuentas.cuentasAbiertas();
    if (abiertas.length === 0) return [];
    // Una sola sucursal: los parámetros son los mismos para todas.
    const parametros = await this.parametros.de(abiertas[0]!.sucursalId);
    return abiertas.map((cuenta) => {
      const total = calcularCuenta(entradaDeCalculo(cuenta, parametros)).totales.total;
      return {
        ordenId: cuenta.ordenId,
        tipo: cuenta.tipo,
        mesas: cuenta.mesas,
        mozo: cuenta.mozo,
        abiertaEn: cuenta.abiertaEn.toISOString(),
        estado: cuenta.estado,
        total,
        saldo: restarMontos(total, cuenta.cobrado),
        modo: cuenta.modo,
      };
    });
  }

  /** Los cobros de una orden, del primero al último, con el comprobante que emitió cada uno (criterio 36). */
  private async cobrosDe(ordenId: string): Promise<CuentaRespuesta['cobros']> {
    const filas = await this.conexion.query<{
      id: string;
      comprobante_id: string;
      total: string;
      creado_en: Date;
      creado_por_usuario_id: string | null;
    }>(
      `SELECT id, comprobante_id, total::text AS total, creado_en, creado_por_usuario_id
         FROM cobro WHERE orden_id = $1`,
      { bind: [ordenId], type: QueryTypes.SELECT },
    );
    if (filas.length === 0) return [];
    const comprobantes = await this.comprobantes.numerosDe(filas.map((f) => f.comprobante_id));
    const detalles = await this.facturado.detalleDeComprobantes(filas.map((f) => f.comprobante_id));
    const nombres = await this.usuarios.nombres(
      filas.flatMap((f) => (f.creado_por_usuario_id === null ? [] : [f.creado_por_usuario_id])),
    );
    return filas
      .flatMap((f) => {
        const c = comprobantes.get(f.comprobante_id);
        const detalleParte = detalles.get(f.comprobante_id);
        return c === undefined || detalleParte === undefined ? [] : [{ f, c, detalleParte }];
      })
      .sort((a, b) => a.c.numeroParte - b.c.numeroParte)
      .map(({ f, c, detalleParte }) => ({
        id: f.id,
        comprobante: { id: c.id, tipo: c.tipo, numero: c.numero },
        total: f.total,
        cobradoEn: f.creado_en.toISOString(),
        cobradoPor:
          f.creado_por_usuario_id === null
            ? null
            : { id: f.creado_por_usuario_id, nombre: nombres.get(f.creado_por_usuario_id) ?? '' },
        detalleParte,
      }));
  }

  /**
   * `POST /cuentas/:ordenId/cobros` (criterios 47 a 63; plan "Flujo del cobro"). Una transacción por petición, con este
   * orden fijo de bloqueos: orden, turno (`FOR SHARE`), serie y cuota. Pasos: topes de monto; réplica por `id`
   * (antes de mirar el turno y la cuenta); la orden bloqueada y su `version`; el turno; los parámetros del emisor; el
   * cálculo de la parte con `packages/dominio`; las reglas del comprobante, de los pagos y del redondeo, todo antes de
   * numerar; la emisión del comprobante; el cobro y los pagos; y lo que pedidos anota en la orden. Si cualquier
   * paso lanza, la transacción se revierte entera: el número, la cuota y la orden. Los eventos salen al confirmar.
   */
  async cobrar(ordenIdCrudo: string, entrada: CobroEntradaValidada): Promise<CobroRespuesta> {
    const sucursalId = this.sesion.sucursalActiva();
    const ordenId = ordenIdCrudo.toLowerCase();
    const id = entrada.id.toLowerCase();
    const normal = normalizar(ordenId, entrada);
    exigirMontosEnRango(normal);
    const huella = huellaDe(normal);

    // Réplica por id (criterio 55). El cerrojo hace que las réplicas simultáneas se turnen y la segunda vea lo ya
    // confirmado en lugar de chocar con la clave primaria.
    await this.turnarPor(`cobro-id:${id}`);
    const previo = await this.replica(id, sucursalId, ordenId, huella);
    if (previo !== undefined) return previo;

    // La orden, con el mismo bloqueo que los envíos (404, 409 `ORDEN_NO_ABIERTA`) y la versión que vio la persona.
    const cuenta = await this.cuentas.cuentaParaCobrar(ordenId, { bloquear: true });
    if (cuenta.version !== entrada.version) throw cuentaCambio(cuenta.version);

    const turno = await this.turnoParaCobrar(normal.turnoId, sucursalId);
    const instante = this.reloj.ahora();
    const parametros = await this.parametros.de(sucursalId, instante, true);
    this.exigirComprobantePermitido(normal, parametros);

    return this.liquidar({
      id,
      ordenId,
      sucursalId,
      cuenta,
      turno,
      normal,
      huella,
      parametros,
      instante,
      alCambiarElTotal: () => cuentaCambio(cuenta.version),
    });
  }

  /**
   * El tipo y el formato del comprobante contra los parámetros del emisor y la tasa de IGV (criterios 50 y 70): 409
   * `COMPROBANTE_NO_PERMITIDO` o `TASA_IGV_NO_CONFIGURADA`, antes de numerar nada. Lo comparte la venta de mostrador.
   */
  exigirComprobantePermitido(normal: EntradaNormalizada, parametros: Parametros): void {
    if (!parametros.tiposPermitidos.includes(normal.comprobante.tipo)) {
      throw comprobanteNoPermitido(
        'El emisor solo puede emitir boletas de venta',
        'comprobante.tipo',
      );
    }
    if (normal.parte.tipo === 'IGUALES' && normal.comprobante.formato === 'DETALLADO') {
      throw comprobanteNoPermitido(
        'En partes iguales el comprobante es por consumo',
        'comprobante.formato',
      );
    }
    if (parametros.regimen !== 'NUEVO_RUS' && parametros.tasaIgv === null) {
      throw tasaIgvNoConfigurada();
    }
  }

  /**
   * Los pasos 5 a 9 del cobro (plan "Flujo del cobro"), compartidos con la venta de mostrador: la parte con
   * `packages/dominio`, el cliente, los pagos, la emisión del comprobante, lo que pedidos anota en la orden y el
   * cobro con sus pagos. La orden ya está bloqueada y el turno tomado por quien llama. `alCambiarElTotal` da el error
   * de un `total` distinto del calculado (cada ruta lo informa a su manera).
   */
  async liquidar(d: {
    id: string;
    ordenId: string;
    sucursalId: string;
    cuenta: CuentaParaCobrar;
    turno: FilaTurnoDeCobro;
    normal: EntradaNormalizada;
    huella: Buffer;
    parametros: Parametros;
    instante: Date;
    alCambiarElTotal: (totalCalculado: string) => Error;
  }): Promise<CobroRespuesta> {
    const { id, ordenId, sucursalId, cuenta, turno, normal, huella, parametros, instante } = d;
    // La parte: lo que falta de la cuenta menos lo que tomaron las partes anteriores (comprobantes de la orden).
    const entradaCuenta = entradaDeCalculo(cuenta, parametros);
    const anteriores = await this.facturado.facturadoDeOrden(ordenId);
    let resultado: ResultadoParte;
    try {
      resultado = calcularParte(
        entradaCuenta,
        anteriores,
        normal.parte as ParteEntrada,
        normal.comprobante.formato,
      );
    } catch (error) {
      // Las partes ya cobradas no cuadran con la cuenta (cambió sin pasar por el puerto `COBROS`): se recarga.
      if (error instanceof RangeError) throw cuentaCambio(cuenta.version);
      throw error;
    }
    if (!resultado.valida) {
      throw resultado.codigo === 'NADA_QUE_COBRAR' ? nadaQueCobrar() : parteInvalida();
    }
    const parte = resultado;
    if (parte.totales.total !== normal.total) throw d.alCambiarElTotal(parte.totales.total);
    if (excedeMontoMaximo(parte.totales.total)) throw montoFueraDeRango('total');

    // Cliente, pagos y redondeo, antes de numerar.
    this.exigirCliente(normal, parte.totales.total);
    const vuelto = this.validarPagos(normal);

    // Emisión: numera con la serie de la caja del turno y guarda el comprobante con el detalle de la parte.
    const impresora = await this.impresoras.deLaCaja(turno.caja_id);
    const emitido = await this.emision.emitir({
      sucursalId,
      cajaId: turno.caja_id,
      turnoId: turno.id,
      turnoResponsableId: turno.responsable_id,
      cobroId: id,
      numeroParte: cuenta.cobros + 1,
      impresora,
      tipo: normal.comprobante.tipo,
      formato: normal.comprobante.formato,
      cliente: normal.comprobante.cliente ?? null,
      parte,
      tasaIgv: parametros.tasaIgv,
      descripciones: new Map(
        cuenta.lineas.map((l) => [
          l.itemId,
          l.modificadores.length === 0 ? l.nombre : `${l.nombre} [${l.modificadores.join(', ')}]`,
        ]),
      ),
      orden: {
        id: cuenta.ordenId,
        mesas: cuenta.mesas.map((m) => m.nombre),
        mozo: cuenta.mozo?.nombre ?? null,
        numeroLlamado: cuenta.numeroLlamado,
      },
      pagos: normal.pagos.map((p) => ({
        medio: p.medio,
        monto: p.monto,
        recibido: p.recibido ?? null,
        operacion: p.operacion ?? null,
      })),
      redondeo: normal.redondeo,
      vuelto,
      instante,
    });

    // Lo que pedidos anota en la orden: ítems cobrados, monto, ICBPER, modo y, si no falta nada, el cierre.
    const tras = await this.cuentas.registrarCobro({
      ordenId,
      itemsFacturados: parte.porItem.map((i) => ({ itemId: i.itemId, cantidad: i.cantidad })),
      monto: parte.totales.total,
      icbper: parte.totales.icbper,
      tipo: parte.tipo,
      cierraLaCuenta: parte.cierraLaCuenta,
      ahora: instante,
    });
    const totalCuenta = calcularCuenta(entradaCuenta).totales.total;
    const cobrado = sumarMontos([cuenta.cobrado, parte.totales.total]);
    const saldo = parte.cierraLaCuenta ? '0.00' : restarMontos(totalCuenta, cobrado);

    const respuesta: CobroRespuesta = {
      id,
      ordenId,
      turnoId: turno.id,
      parte: normal.parte,
      total: parte.totales.total,
      redondeo: normal.redondeo,
      vuelto,
      pagos: normal.pagos.map((p) => ({
        medio: p.medio,
        monto: p.monto,
        recibido: p.recibido ?? null,
        operacion: p.operacion ?? null,
      })),
      comprobante: emitido.comprobante,
      cuenta: { estado: tras.estado, saldo, version: tras.version },
      impresion: emitido.impresion,
      trabajoId: emitido.trabajoId,
    };
    await this.guardar(respuesta, huella, parte.tipo, normal, instante);
    this.eventos.turnoCambio(sucursalId, turno.id, turno.caja_id);
    return respuesta;
  }

  /** La réplica por `id` (criterio 55): el cobro ya hecho, sin efectos, o 422 si el mismo `id` es otra petición. */
  async replica(
    id: string,
    sucursalId: string,
    ordenId: string,
    huella: Buffer,
  ): Promise<CobroRespuesta | undefined> {
    const filas = await this.conexion.query<FilaReplica>(
      `SELECT c.orden_id, t.sucursal_id, t.responsable_id, c.huella_entrada, c.respuesta
         FROM cobro c JOIN turno t ON t.id = c.turno_id AND t.empresa_id = c.empresa_id
        WHERE c.id = $1`,
      { bind: [id], type: QueryTypes.SELECT },
    );
    const previo = filas[0];
    if (previo === undefined) return undefined;
    if (
      previo.sucursal_id !== sucursalId ||
      previo.orden_id !== ordenId ||
      !previo.huella_entrada.equals(huella)
    ) {
      throw idDeClienteReutilizado();
    }
    // La respuesta guardada trae el comprobante y los pagos de ese turno: solo la ve quien puede cobrar en él.
    if (!this.veTodosLosTurnos() && previo.responsable_id !== this.sesion.principal().usuarioId) {
      throw turnoAjeno();
    }
    return previo.respuesta;
  }

  /** El Supervisor y el Administrador cobran (y ven las réplicas) en el turno de cualquier Cajero de la sucursal. */
  private veTodosLosTurnos(): boolean {
    const principal = this.sesion.principal();
    return (
      principal.esAdministrador ||
      principal.rol === 'SUPERVISOR' ||
      principal.rol === 'ADMINISTRADOR'
    );
  }

  /**
   * El turno con `FOR SHARE`: varios cobros de un turno corren a la vez y todos esperan al cierre, que lo toma con
   * `FOR UPDATE` (criterio 59). 404 si no es de la sucursal activa; 409 `TURNO_AJENO` si no es del que cobra ni este es
   * Supervisor o Administrador; 409 `TURNO_CERRADO`.
   */
  async turnoParaCobrar(turnoId: string, sucursalId: string): Promise<FilaTurnoDeCobro> {
    const filas = await this.conexion.query<FilaTurnoDeCobro>(
      `SELECT id, caja_id, responsable_id, estado FROM turno
        WHERE id = $1 AND sucursal_id = $2 FOR SHARE`,
      { bind: [turnoId, sucursalId], type: QueryTypes.SELECT },
    );
    const turno = filas[0];
    if (turno === undefined) throw noEncontrado('El turno');
    if (!this.veTodosLosTurnos() && turno.responsable_id !== this.sesion.principal().usuarioId) {
      throw turnoAjeno();
    }
    if (turno.estado !== 'ABIERTO') throw turnoCerrado();
    return turno;
  }

  /** Una factura exige un cliente con RUC y dirección; una boleta de más de S/ 700 exige documento y nombre (criterio 51). */
  exigirCliente(normal: EntradaNormalizada, total: string): void {
    const cliente = normal.comprobante.cliente;
    if (normal.comprobante.tipo === 'FACTURA') {
      if (
        cliente === undefined ||
        cliente.tipoDocumento !== 'RUC' ||
        cliente.direccion === undefined
      ) {
        throw clienteRequerido(
          'Una factura necesita el cliente con su RUC, su razón social y su dirección',
        );
      }
      return;
    }
    if (cliente === undefined && compararMontos(total, MONTO_BOLETA_SIN_DOCUMENTO) > 0) {
      throw clienteRequerido(
        `Una boleta de más de S/ ${MONTO_BOLETA_SIN_DOCUMENTO} necesita el documento y el nombre del cliente`,
      );
    }
  }

  /**
   * Los pagos contra el total y el redondeo con `validarPagos` (criterio 50). Devuelve el vuelto; 422
   * `PAGOS_NO_CUADRAN` si no cuadran (también un redondeo que no es el que corresponde al efectivo).
   */
  validarPagos(normal: EntradaNormalizada): string {
    const pagos: PagoEntrada[] = normal.pagos.map((p) => ({
      medio: p.medio,
      monto: p.monto,
      ...(p.recibido === undefined ? {} : { recibido: p.recibido }),
    }));
    let resultado: ReturnType<typeof validarPagos>;
    try {
      resultado = validarPagos(normal.total, pagos, normal.redondeo);
    } catch (error) {
      if (error instanceof RangeError) throw pagosNoCuadran();
      throw error;
    }
    if (!resultado.valido) throw pagosNoCuadran();
    return resultado.vuelto;
  }

  /** Guarda el cobro con su respuesta original y sus pagos (el comprobante ya está emitido). */
  private async guardar(
    respuesta: CobroRespuesta,
    huella: Buffer,
    tipo: TipoParte,
    normal: EntradaNormalizada,
    instante: Date,
  ): Promise<void> {
    const empresaId = this.contexto.empresaActual();
    await this.conexion.query(
      `INSERT INTO cobro (id, empresa_id, orden_id, turno_id, comprobante_id, modo, parte, total, redondeo, vuelto,
                          huella_entrada, respuesta, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::numeric, $9::numeric, $10::numeric, $11, $12::jsonb, $13, $13)`,
      {
        bind: [
          respuesta.id,
          empresaId,
          respuesta.ordenId,
          respuesta.turnoId,
          respuesta.comprobante.id,
          tipo,
          JSON.stringify(normal.parte),
          respuesta.total,
          respuesta.redondeo,
          respuesta.vuelto,
          huella,
          JSON.stringify(respuesta),
          instante,
        ],
        type: QueryTypes.INSERT,
      },
    );
    if (respuesta.pagos.length === 0) return;
    await this.conexion.query(
      `INSERT INTO pago (empresa_id, cobro_id, turno_id, medio, monto, recibido, operacion, creado_en, actualizado_en)
       SELECT $1::uuid, $2::uuid, $3::uuid, x.medio, x.monto::numeric, x.recibido::numeric, x.operacion, $5, $5
         FROM jsonb_to_recordset($4::jsonb) AS x(medio text, monto text, recibido text, operacion text)`,
      {
        bind: [
          empresaId,
          respuesta.id,
          respuesta.turnoId,
          JSON.stringify(respuesta.pagos),
          instante,
        ],
        type: QueryTypes.INSERT,
      },
    );
  }

  /**
   * Cerrojo de la transacción por una clave de texto: las peticiones con la misma clave se turnan. La clave lleva la
   * empresa (`<empresaId>:<clave>`): el espacio de cerrojos es de toda la base y una empresa nunca debe esperar a otra.
   */
  async turnarPor(clave: string): Promise<void> {
    await this.conexion.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', {
      bind: [`${this.contexto.empresaActual()}:${clave}`],
      type: QueryTypes.SELECT,
    });
  }
}

/** La entrada de `calcularCuenta` de una cuenta de pedidos con los parámetros de la sucursal. */
function entradaDeCalculo(cuenta: CuentaParaCobrar, parametros: Parametros): CuentaEntrada {
  return {
    lineas: cuenta.lineas.map((l) => ({
      itemId: l.itemId,
      precioUnitario: l.precioUnitario,
      cantidad: l.cantidad,
      cantidadCortesia: l.cantidadCortesia,
      afectacion: l.afectacion,
      aplicaIcbper: l.aplicaIcbper,
      descuento: l.descuento === null ? null : { tipo: l.descuento.tipo, valor: l.descuento.valor },
    })),
    descuentoCuenta:
      cuenta.descuentoCuenta === null
        ? null
        : { tipo: cuenta.descuentoCuenta.tipo, valor: cuenta.descuentoCuenta.valor },
    // Sin tasa vigente (Nuevo RUS o un emisor que no configuró ninguna) la cuenta no desglosa IGV: `operaciones`
    // `null` e `igv` `"0.00"`. La tasa no tiene valor por defecto; el cobro responde 409 `TASA_IGV_NO_CONFIGURADA`.
    tasaIgv: parametros.tasaIgv,
    montoIcbper: parametros.montoIcbper,
  };
}
