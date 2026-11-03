import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  CODIGO_MESA_REGEX,
  llamadoPublicoSchema,
  type CampoError,
  type LlamadoEntradaValidada,
  type LlamadoPublico,
  type LineaPreparada,
} from '@restaurante/contratos';
import {
  aceptaLlamados,
  destinatariosDeLlamado,
  estadoVigenteLlamado,
  excedeMontoMaximo,
  totalOrden,
  venceEnLlamado,
} from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { ENTORNO, type Entorno } from '../../config/entorno';
import { CONEXION_API, SQLSTATE, restriccionDe, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { derivarClaveHuellaIp, huellaDeIp } from '../../nucleo/http/ip-cliente';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { CartaVentaService, ErrorProductoNoVendible, ErrorSeleccionInvalida } from '../carta';
import { ContextoPublico, cartaNoDisponible } from '../carta-web';
import { PedidosConsultaService } from '../pedidos';
import { SucursalesConsultaService } from '../plataforma';
import { CodigosMesaService } from '../salon';
import {
  conflictoDeCreacion,
  demasiadosLlamados,
  fueraDeHorario,
  idReutilizado,
  lineasRechazadas,
  llamadoPendiente,
  montoFueraDeRango,
} from './errores-llamados';
import { EventosLlamados } from './eventos-llamados';
import { LimitesLlamados } from './limites-llamados';
import { huellaDeEntrada, normalizarEntrada, type EntradaNormalizada } from './replica-llamado';
import { ResolucionMesa, type MesaResuelta } from './resolucion-mesa';
import { TopeDeCreaciones } from './tope-de-creaciones';

/** Una línea del llamado tal como se guarda: la que vio el cliente, con los precios de ese momento. */
export interface LineaGuardada {
  productoId: string;
  nombre: string;
  modificadorIds: string[];
  modificadores: { id: string; nombre: string; precioExtra: string }[];
  cantidad: number;
  observacion: string | null;
  precioUnitario: string;
  total: string;
}

interface Rechazo {
  codigo: ErrorAplicacion['codigo'];
  mensaje: string;
  campo: CampoError;
}

/**
 * Crear un llamado desde la mesa (historia 005, criterios 26 a 37; ruta crítica P2): dueño de `llamado` junto con los
 * demás servicios del módulo. Una sola transacción, la del contexto público (`ContextoPublico`, actor `carta-web`).
 * El orden de los rechazos es el del criterio 34: lo barato va antes que validar la carta.
 *
 * Los cerrojos van siempre en este orden: el de la huella de la IP y la sucursal (serializa el límite por conexión) y
 * después la fila de `mesa_qr` del código (serializa réplicas, uno pendiente y el límite por mesa). Crear no crea
 * orden, envío, ítem, comanda ni trabajo de impresión, no llama al inventario ni cambia la mesa (criterio 28).
 */
@Injectable()
export class CreacionLlamadosService {
  private readonly claveIp: Buffer;

  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ENTORNO) entorno: Entorno,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(ContextoPublico) private readonly publico: ContextoPublico,
    @Inject(ResolucionMesa) private readonly mesas: ResolucionMesa,
    @Inject(CodigosMesaService) private readonly codigos: CodigosMesaService,
    @Inject(PedidosConsultaService) private readonly pedidos: PedidosConsultaService,
    @Inject(SucursalesConsultaService) private readonly sucursales: SucursalesConsultaService,
    @Inject(CartaVentaService) private readonly carta: CartaVentaService,
    @Inject(LimitesLlamados) private readonly limites: LimitesLlamados,
    @Inject(EventosLlamados) private readonly eventos: EventosLlamados,
    @Inject(TopeDeCreaciones) private readonly tope: TopeDeCreaciones,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {
    this.claveIp = derivarClaveHuellaIp(entorno.PIN_PEPPER);
  }

  /**
   * `POST /publico/mesas/:codigo/llamados` (201 `llamadoPublico`). `ip` es la IP del cliente (de la cabecera de
   * `CABECERA_IP_CLIENTE` o de la conexión): solo se guarda su huella.
   */
  async crear(
    codigo: string,
    entrada: LlamadoEntradaValidada,
    ip: string | undefined,
  ): Promise<LlamadoPublico> {
    // Una forma inválida responde 404 sin consultar nada ni ocupar un lugar del tope.
    if (!CODIGO_MESA_REGEX.test(codigo)) throw cartaNoDisponible();
    const normalizada = normalizarEntrada(entrada);
    const soltar = this.tope.entrar(codigo, normalizada.id);
    try {
      return await this.publico.porCodigoDeMesa(codigo, () =>
        this.crearDentro(codigo, entrada, normalizada, ip),
      );
    } finally {
      soltar();
    }
  }

  private async crearDentro(
    codigo: string,
    entrada: LlamadoEntradaValidada,
    normalizada: EntradaNormalizada,
    ip: string | undefined,
  ): Promise<LlamadoPublico> {
    const empresaId = this.contexto.empresaActual();
    const ahora = this.reloj.ahora();

    // 404 del código (criterios 10 y 14): mesa activa, carta publicada y plan con PEDIDOS_WEB.
    const mesa = await this.mesas.resolver(codigo);

    // Cerrojos, siempre en este orden: la conexión (IP y sucursal) y después la mesa.
    const huellaIp = huellaDeIp(this.claveIp, ip ?? '');
    await this.bloquearConexion(huellaIp, mesa.sucursalId);
    const bloqueada = await this.codigos.bloquearPorCodigo(codigo);
    if (bloqueada === null || !bloqueada.activa) throw cartaNoDisponible();

    // Réplica por id (criterio 29): antes que el horario, el pendiente y los límites.
    const huellaEntrada = huellaDeEntrada(normalizada);
    const replica = await this.buscarReplica(normalizada.id, mesa.mesaId, huellaEntrada);
    if (replica !== null) return replica;

    // Horario (criterio 35): dentro del horario, con una cuenta abierta o sin horario cargado.
    const ordenes = await this.pedidos.ordenesVigentesDeMesas([mesa.mesaId]);
    const orden = ordenes.get(mesa.mesaId);
    const datos = (await this.sucursales.datosPublicos([mesa.sucursalId])).get(mesa.sucursalId);
    if (
      !aceptaLlamados({
        horario: datos?.horario ?? [],
        ahora,
        mesaConCuenta: orden !== undefined,
      })
    ) {
      throw fueraDeHorario();
    }

    // Uno pendiente por mesa (criterios 30 y 31): un vencido se guarda como tal y no bloquea.
    await this.exigirSinPendiente(mesa.mesaId, ahora);

    // Límites (criterios 32 y 33): por mesa y por conexión.
    const porMesa = await this.limites.porMesa(mesa.mesaId, ahora);
    if (!porMesa.permitido) throw demasiadosLlamados(porMesa.reintentarEnSegundos);
    const porConexion = await this.limites.porConexion(mesa.sucursalId, huellaIp, ahora);
    if (!porConexion.permitido) throw demasiadosLlamados(porConexion.reintentarEnSegundos);

    // Líneas (criterio 27): todo o nada, y los topes de monto.
    const lineas = entrada.tipo === 'PEDIDO' ? await this.prepararLineas(mesa, entrada, ahora) : [];
    const total =
      entrada.tipo === 'PEDIDO'
        ? totalOrden(
            lineas.map((l) => ({
              precioUnitario: l.precioUnitario,
              cantidad: l.cantidad,
              cantidadAnulada: 0,
            })),
          )
        : null;
    if (total !== null && excedeMontoMaximo(total)) {
      throw montoFueraDeRango([
        { campo: 'lineas', mensaje: 'El total del pedido supera el máximo' },
      ]);
    }

    // Lo que queda guardado (criterio 37) y la respuesta que ve el cliente (criterio 26).
    const venceEn = venceEnLlamado(ahora);
    const destinatarios = destinatariosDeLlamado(orden?.mozoId ?? null);
    const respuesta = llamadoPublicoSchema.parse({
      id: normalizada.id,
      tipo: entrada.tipo,
      estado: 'PENDIENTE',
      creadoEn: ahora.toISOString(),
      venceEn: venceEn.toISOString(),
      lineas: lineas.map((l) => ({
        nombre: l.nombre,
        modificadores: l.modificadores.map((m) => m.nombre),
        cantidad: l.cantidad,
        observacion: l.observacion,
        precioUnitario: l.precioUnitario,
        total: l.total,
      })),
      total,
    });
    await this.insertar({
      id: normalizada.id,
      empresaId,
      mesa,
      tipo: entrada.tipo,
      lineas,
      nota: normalizada.nota,
      total,
      huellaIp,
      huellaEntrada,
      respuesta,
      venceEn,
      destinatarioMozoId: destinatarios?.[0] ?? null,
      ordenId: orden?.ordenId ?? null,
      ahora,
    });

    // Aviso al mozo después de confirmar (criterio 36).
    this.eventos.nuevo(mesa.sucursalId, {
      llamadoId: normalizada.id,
      tipo: entrada.tipo,
      mesaId: mesa.mesaId,
      mesaNombre: mesa.mesaNombre,
      destinatarios,
    });
    return respuesta;
  }

  /** `pg_advisory_xact_lock` con una llave de 64 bits derivada de la huella de la IP y la sucursal (criterio 33). */
  private async bloquearConexion(huellaIp: Buffer, sucursalId: string): Promise<void> {
    const llave = createHash('sha256')
      .update(huellaIp)
      .update(`:${sucursalId}`)
      .digest()
      .readBigInt64BE(0);
    await this.conexion.query('SELECT pg_advisory_xact_lock($1::bigint)', {
      bind: [llave.toString()],
      type: QueryTypes.SELECT,
    });
  }

  /**
   * La réplica por `id` (criterio 29): si el llamado ya existe en esta empresa, con la misma mesa y la misma entrada,
   * la respuesta de la primera vez; si es otra mesa u otra entrada, 422. `null` si el `id` es nuevo.
   */
  private async buscarReplica(
    id: string,
    mesaId: string,
    huella: Buffer,
  ): Promise<LlamadoPublico | null> {
    const filas = await this.conexion.query<{
      mesa_id: string;
      huella_entrada: Buffer;
      respuesta_creacion: unknown;
    }>('SELECT mesa_id, huella_entrada, respuesta_creacion FROM llamado WHERE id = $1', {
      bind: [id],
      type: QueryTypes.SELECT,
    });
    const existente = filas[0];
    if (existente === undefined) return null;
    if (existente.mesa_id !== mesaId || !huella.equals(existente.huella_entrada)) {
      throw idReutilizado();
    }
    return llamadoPublicoSchema.parse(existente.respuesta_creacion);
  }

  /** 409 `LLAMADO_PENDIENTE` si la mesa tiene un pendiente vigente; si venció, lo guarda `VENCIDO` (criterio 31). */
  private async exigirSinPendiente(mesaId: string, ahora: Date): Promise<void> {
    const pendientes = await this.conexion.query<{ id: string; vence_en: Date }>(
      `SELECT id, vence_en FROM llamado WHERE mesa_id = $1 AND estado = 'PENDIENTE' FOR UPDATE`,
      { bind: [mesaId], type: QueryTypes.SELECT },
    );
    for (const pendiente of pendientes) {
      const venceEn = new Date(pendiente.vence_en);
      if (estadoVigenteLlamado({ estado: 'PENDIENTE', venceEn }, ahora) === 'PENDIENTE') {
        throw llamadoPendiente();
      }
      await this.conexion.query(
        `UPDATE llamado SET estado = 'VENCIDO', vencido_en = vence_en, actualizado_en = $2 WHERE id = $1`,
        { bind: [pendiente.id, ahora], type: QueryTypes.UPDATE },
      );
    }
  }

  /** Cada línea con la carta de la sucursal de la mesa (criterio 27): una entrada de `campos` por línea rechazada. */
  private async prepararLineas(
    mesa: MesaResuelta,
    entrada: Extract<LlamadoEntradaValidada, { tipo: 'PEDIDO' }>,
    ahora: Date,
  ): Promise<LineaGuardada[]> {
    const resultados = await this.carta.prepararLineas(
      mesa.sucursalId,
      entrada.lineas.map((l) => ({
        productoId: l.productoId,
        modificadorIds: l.modificadorIds,
        cantidad: l.cantidad,
      })),
      ahora,
    );
    const rechazos: Rechazo[] = [];
    const preparadas: LineaPreparada[] = [];
    resultados.forEach((resultado, indice) => {
      if (resultado.ok) {
        preparadas.push(resultado.linea);
        return;
      }
      const rechazo = rechazoDeLinea(indice, resultado.error);
      if (rechazo === undefined) throw resultado.error;
      rechazos.push(rechazo);
    });
    const primero = rechazos[0];
    if (primero !== undefined) {
      throw lineasRechazadas(
        { codigo: primero.codigo, mensaje: primero.mensaje },
        rechazos.map((r) => r.campo),
      );
    }

    const fuera: CampoError[] = [];
    preparadas.forEach((linea, indice) => {
      if (excedeMontoMaximo(linea.precioUnitario) || excedeMontoMaximo(linea.total)) {
        fuera.push({ campo: `lineas.${indice}`, mensaje: 'El monto de la línea supera el máximo' });
      }
    });
    if (fuera.length > 0) throw montoFueraDeRango(fuera);

    return preparadas.map((linea, indice) => ({
      productoId: linea.productoId,
      nombre: linea.nombre,
      modificadorIds: linea.modificadores.map((m) => m.id),
      modificadores: linea.modificadores.map((m) => ({
        id: m.id,
        nombre: m.nombre,
        precioExtra: m.precioExtra,
      })),
      cantidad: linea.cantidad,
      observacion: entrada.lineas[indice]?.observacion ?? null,
      precioUnitario: linea.precioUnitario,
      total: linea.total,
    }));
  }

  private async insertar(fila: {
    id: string;
    empresaId: string;
    mesa: MesaResuelta;
    tipo: string;
    lineas: LineaGuardada[];
    nota: string | null;
    total: string | null;
    huellaIp: Buffer;
    huellaEntrada: Buffer;
    respuesta: LlamadoPublico;
    venceEn: Date;
    destinatarioMozoId: string | null;
    ordenId: string | null;
    ahora: Date;
  }): Promise<void> {
    try {
      await this.conexion.query(
        `INSERT INTO llamado (id, empresa_id, sucursal_id, mesa_id, tipo, estado, lineas, nota, total,
                              huella_ip, huella_entrada, respuesta_creacion, vence_en,
                              destinatario_mozo_id, orden_id, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, 'PENDIENTE', $6::jsonb, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $15)`,
        {
          bind: [
            fila.id,
            fila.empresaId,
            fila.mesa.sucursalId,
            fila.mesa.mesaId,
            fila.tipo,
            JSON.stringify(fila.lineas),
            fila.nota,
            fila.total,
            fila.huellaIp,
            fila.huellaEntrada,
            JSON.stringify(fila.respuesta),
            fila.venceEn,
            fila.destinatarioMozoId,
            fila.ordenId,
            fila.ahora,
          ],
          type: QueryTypes.INSERT,
        },
      );
    } catch (error) {
      if (sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD) {
        // La red del índice único parcial (criterio 30) o dos creaciones del mismo id en mesas distintas: la
        // transacción ya no sirve y la petición se puede repetir (una réplica responde 201).
        throw restriccionDe(error) === 'llamado_pendiente_por_mesa'
          ? llamadoPendiente()
          : conflictoDeCreacion();
      }
      throw error;
    }
  }
}

/**
 * Convierte el rechazo de `prepararLineas` en la entrada de `campos` de su línea (criterio 27): el motivo de un
 * producto que no se vende, los errores de una selección inválida y, para un producto de otra empresa, de otra
 * sucursal o inexistente, un mensaje fijo sin el id (criterio 15). `undefined` si no es un rechazo de la línea.
 */
function rechazoDeLinea(indice: number, error: unknown): Rechazo | undefined {
  const campo = `lineas.${indice}`;
  // Un producto de la empresa que esta sucursal no ofrece, o que está desactivado, se rechaza igual que uno que no
  // existe: el cliente no puede saber qué hay en las otras sucursales ni qué se desactivó (criterio 15 y decisión del
  // orquestador de la C3). El mozo sí ve el motivo real en la revisión del detalle.
  if (
    error instanceof ErrorProductoNoVendible &&
    error.motivo !== 'NO_DISPONIBLE' &&
    error.motivo !== 'INACTIVO'
  ) {
    return {
      codigo: error.codigo,
      mensaje: error.message,
      campo: { campo, mensaje: error.motivo },
    };
  }
  if (error instanceof ErrorSeleccionInvalida) {
    // Un modificador desconocido (de otra empresa o inexistente) se informa sin el id: el cuerpo es el mismo.
    const detalle = (error.campos ?? []).map((c) => {
      if (c.campo.startsWith('grupos.')) return `${c.mensaje} (${c.campo})`;
      return c.mensaje.startsWith('MODIFICADOR_DESCONOCIDO')
        ? 'MODIFICADOR_DESCONOCIDO'
        : c.mensaje;
    });
    return {
      codigo: error.codigo,
      mensaje: error.message,
      campo: { campo, mensaje: detalle.join('; ') },
    };
  }
  if (
    (error instanceof ErrorAplicacion && error.codigo === 'NO_ENCONTRADO') ||
    error instanceof ErrorProductoNoVendible
  ) {
    return {
      codigo: 'PRODUCTO_NO_VENDIBLE',
      mensaje: 'El producto no existe',
      campo: { campo, mensaje: 'PRODUCTO_NO_EXISTE' },
    };
  }
  return undefined;
}
