import { Inject, Injectable } from '@nestjs/common';
import type {
  EmisorCrearEntrada,
  EmisorRespuesta,
  TasaIgvEntrada,
  TasaIgvRespuesta,
} from '@restaurante/contratos';
import type { RegimenTributario } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API, SQLSTATE, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { Cifrado, CifradoInvalidoError } from '../../nucleo/cifrado';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { MODELOS_API, type EmisorModelo, type Modelos } from './modelos';
import { UltimaEmisionDeEmisor } from './ultima-emision';

/** Lo que `configurarTasaIgv` espera a los cobros en curso del emisor antes de responder 409 `CONFLICTO`. */
const ESPERA_MAXIMA_DE_COBROS_MS = 3_000;
/** Pausa entre un intento de bloquear al emisor y el siguiente. */
const PAUSA_ENTRE_INTENTOS_MS = 25;

/** Fila de la tabla a la forma de `emisorRespuesta` (fechas ISO 8601). */
export function emisorARespuesta(emisor: EmisorModelo): EmisorRespuesta {
  return {
    id: emisor.id,
    empresaId: emisor.empresaId,
    ruc: emisor.ruc,
    razonSocial: emisor.razonSocial,
    regimen: emisor.regimen,
    creadoEn: emisor.creadoEn.toISOString(),
    actualizadoEn: emisor.actualizadoEn.toISOString(),
  };
}

/**
 * Lo que un comprobante guarda del emisor y de la sucursal al emitirse (historia 006, criterio 69): la sucursal con
 * su código de establecimiento y el emisor con su RUC, razón social y régimen.
 */
export interface DatosParaComprobante {
  sucursal: { id: string; nombre: string; direccion: string; codigoEstablecimiento: string };
  emisor: { id: string; ruc: string; razonSocial: string; regimen: RegimenTributario };
}

/**
 * La configuración del PSE de un emisor ya descifrada (historia 006, criterio 122): solo la usan `RegistroDeConectores` y el
 * worker, y la credencial existe en memoria únicamente durante una llamada al PSE.
 */
export interface ConfiguracionPseDescifrada {
  modo: 'SIMULADO' | 'REAL';
  /** El `PSE_CONECTOR` con que se pasó a `REAL`; `null` en `SIMULADO`. */
  conector: string | null;
  /** `null` si no tiene credencial o si no se pudo descifrar (en ese caso `credencialIlegible` es `true`). */
  credencial: Readonly<Record<string, string>> | null;
  /**
   * Hay una credencial guardada pero no se pudo abrir (clave cambiada, datos asociados que no coinciden, contenido
   * alterado): el intento termina en `ERROR_CONFIGURACION` y nunca se usa otra credencial (criterio 123).
   */
  credencialIlegible: boolean;
}

/** `datosAsociados` del cifrado de la credencial: un cifrado copiado a la fila de otro emisor no se abre (criterio 123). */
export function datosAsociadosDeCredencial(empresaId: string, emisorId: string): string {
  return `credencial-pse:${empresaId}:${emisorId}`;
}

/**
 * Emisores de la empresa del contexto activo (RF-01). Debe llamarse dentro de `ContextoEmpresa.ejecutar`:
 * los modelos son los de la conexión de la API, así que con contexto la RLS limita todo a la propia empresa.
 */
@Injectable()
export class EmisoresService {
  constructor(
    @Inject(MODELOS_API) private readonly modelos: Modelos,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(UltimaEmisionDeEmisor) private readonly ultimaEmision: UltimaEmisionDeEmisor,
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(Cifrado) private readonly cifrado: Cifrado,
  ) {}

  /**
   * La configuración del PSE del emisor, con la credencial descifrada (historia 006, 6b, criterios 122 y 123); `null` si el
   * emisor no tiene configuración. Con el contexto de la empresa de la petición o del trabajo (RLS). La usan solo
   * `RegistroDeConectores` y el worker: el valor descifrado vive en memoria durante una llamada al PSE y no se registra.
   * Una credencial que no se puede abrir no lanza: `credencialIlegible`.
   */
  async configuracionPse(emisorId: string): Promise<ConfiguracionPseDescifrada | null> {
    const filas = await this.conexion.query<{
      empresa_id: string;
      modo: 'SIMULADO' | 'REAL';
      conector: string | null;
      credencial: Buffer | null;
    }>(
      `SELECT empresa_id, modo, conector, credencial FROM configuracion_pse WHERE emisor_id = $1`,
      { bind: [emisorId], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    if (fila === undefined) return null;
    let credencial: Record<string, string> | null = null;
    let credencialIlegible = false;
    if (fila.credencial !== null) {
      try {
        credencial = JSON.parse(
          this.cifrado.abrir(fila.credencial, {
            proposito: 'credencial-pse',
            datosAsociados: datosAsociadosDeCredencial(fila.empresa_id, emisorId),
          }),
        ) as Record<string, string>;
      } catch (error) {
        if (!(error instanceof CifradoInvalidoError) && !(error instanceof SyntaxError))
          throw error;
        credencialIlegible = true;
      }
    }
    return { modo: fila.modo, conector: fila.conector, credencial, credencialIlegible };
  }

  /**
   * Solo el modo del emisor (`SIMULADO`, `REAL` o `null` sin configuración), sin tocar la credencial: la emisión lo lee,
   * sin bloquear, para copiar `comprobante.simulado` (criterio 122).
   */
  async modoPse(emisorId: string): Promise<'SIMULADO' | 'REAL' | null> {
    const filas = await this.conexion.query<{ modo: 'SIMULADO' | 'REAL' }>(
      `SELECT modo FROM configuracion_pse WHERE emisor_id = $1`,
      { bind: [emisorId], type: QueryTypes.SELECT },
    );
    return filas[0]?.modo ?? null;
  }

  /**
   * Si algún emisor de las sucursales dadas está en modo `SIMULADO` (criterio 122): el aviso permanente de la PWA. Un
   * emisor sin configuración no cuenta. Una sola consulta.
   */
  async hayModoSimulado(sucursalIds: readonly string[]): Promise<boolean> {
    if (sucursalIds.length === 0) return false;
    const filas = await this.conexion.query<{ simulado: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM sucursal s
           JOIN configuracion_pse c ON c.emisor_id = s.emisor_id AND c.empresa_id = s.empresa_id
          WHERE s.id = ANY($1::uuid[]) AND c.modo = 'SIMULADO') AS simulado`,
      { bind: [[...sucursalIds]], type: QueryTypes.SELECT },
    );
    return filas[0]?.simulado === true;
  }

  /**
   * Toma la fila del emisor con `FOR SHARE` hasta el final de la transacción (reemisión y notas de crédito, plan,
   * «Orden de los cerrojos»): choca con el cambio de tasa, así que «la última fecha de emisión del emisor» que mira
   * `configurarTasaIgv` ya incluye a esta emisión. 404 si el emisor no es de la empresa.
   */
  async bloquearParaEmitir(emisorId: string): Promise<void> {
    await this.exigirEmisor(emisorId, 'compartido');
  }

  async listar(): Promise<EmisorRespuesta[]> {
    const filas = await this.modelos.Emisor.findAll({
      order: [
        ['razonSocial', 'ASC'],
        ['ruc', 'ASC'],
      ],
    });
    return filas.map(emisorARespuesta);
  }

  /** `POST /emisores`: un RUC ya registrado (en cualquier empresa) responde 400 `DATOS_INVALIDOS` con el campo. */
  async crear(entrada: EmisorCrearEntrada): Promise<EmisorRespuesta> {
    try {
      const creado = await this.modelos.Emisor.create({
        empresaId: this.contexto.empresaActual(),
        ruc: entrada.ruc,
        razonSocial: entrada.razonSocial,
        regimen: entrada.regimen,
      });
      return emisorARespuesta(creado);
    } catch (error) {
      if (sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD) {
        throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'El RUC ya está registrado', [
          { campo: 'ruc', mensaje: 'El RUC ya está registrado' },
        ]);
      }
      throw error;
    }
  }

  /**
   * Las tasas de IGV del emisor en orden de `desde` (historia 006, criterio 6). 404 si el emisor no es de la empresa
   * (uno de otra empresa es indistinguible de uno inexistente).
   */
  async tasasIgv(emisorId: string): Promise<TasaIgvRespuesta[]> {
    await this.exigirEmisor(emisorId);
    return this.leerTasas(emisorId);
  }

  /**
   * Las tasas del emisor para emitir un comprobante con la vigente (cobro y venta de mostrador). Toma la fila del
   * emisor con `FOR SHARE` hasta el final de la transacción: choca con el `FOR NO KEY UPDATE` de
   * `configurarTasaIgv`, de modo que "leer la tasa vigente" y "cambiar la tasa" se turnan (nunca dos tasas para la
   * misma fecha de emisión), pero dos cobros del mismo emisor no se esperan entre sí. Va después de los bloqueos de la
   * orden y del turno y antes del de la serie (el orden fijo del plan).
   */
  async tasasIgvParaEmitir(emisorId: string): Promise<TasaIgvRespuesta[]> {
    await this.exigirEmisor(emisorId, 'compartido');
    return this.leerTasas(emisorId);
  }

  /**
   * Crea o cambia la tasa de IGV del emisor desde una fecha (criterio 6). Repetir el mismo valor responde 200 sin
   * auditoría. No se puede crear ni cambiar una tasa con `desde` igual o anterior a la fecha de Lima del último
   * comprobante emitido por el emisor (409 `CONFLICTO`: las ventas pasadas no se recalculan); esa fecha la da el puerto
   * `UltimaEmisionDeEmisor` que registra facturación y, sin registro, se rechaza (falla cerrado). La fila del emisor se
   * toma con `FOR NO KEY UPDATE`: dos cambios del mismo emisor se turnan y esperan a los cobros en curso del emisor,
   * que leen la tasa con `FOR SHARE` (`tasasIgvParaEmitir`) y la sueltan al confirmar; así la última fecha de emisión
   * que se comprueba abajo ya incluye a esos cobros (409 si es de la fecha o posterior). La espera es de a lo sumo
   * `ESPERA_MAXIMA_DE_COBROS_MS`: con cobros llegando sin pausa el bloqueo podría no llegar nunca (los cobros nuevos
   * toman `FOR SHARE` sin hacer fila detrás de quien espera), así que pasado el plazo responde 409 `CONFLICTO`
   * («Hay cobros en curso; inténtalo de nuevo») sin guardar nada (criterio 90).
   */
  async configurarTasaIgv(
    emisorId: string,
    desde: string,
    entrada: TasaIgvEntrada,
  ): Promise<TasaIgvRespuesta> {
    await this.bloquearEmisorConEspera(emisorId);
    // Un emisor Nuevo RUS no tiene IGV: no se le guarda ninguna tasa (422, sin guardar ni auditar).
    const regimen = await this.conexion.query<{ regimen: RegimenTributario }>(
      'SELECT regimen FROM emisor WHERE id = $1',
      { bind: [emisorId], type: QueryTypes.SELECT },
    );
    if (regimen[0]?.regimen === 'NUEVO_RUS') {
      throw new ErrorAplicacion(
        422,
        'EMISOR_INVALIDO',
        'Un emisor del Nuevo RUS no tiene tasa de IGV',
      );
    }
    // La igualdad es numérica y exacta, en la base (`18` y `18.00` son la misma tasa; sin coma flotante).
    const actuales = await this.conexion.query<{ id: string; tasa: string; igual: boolean }>(
      `SELECT id, tasa::text AS tasa, tasa = $3::numeric AS igual
         FROM emisor_tasa_igv WHERE emisor_id = $1 AND desde = $2::date`,
      { bind: [emisorId, desde, entrada.tasa], type: QueryTypes.SELECT },
    );
    const actual = actuales[0];
    if (actual !== undefined && actual.igual) {
      return { desde, tasa: actual.tasa };
    }
    const ultima = await this.ultimaEmision.fecha(emisorId);
    if (ultima !== null && desde <= ultima) {
      throw new ErrorAplicacion(
        409,
        'CONFLICTO',
        `El emisor ya emitió comprobantes hasta el ${ultima}: no se puede crear ni cambiar una tasa desde esa fecha o una anterior`,
        [{ campo: 'desde', mensaje: 'Debe ser posterior al último comprobante emitido' }],
      );
    }
    const guardadas = await this.conexion.query<{ id: string; tasa: string }>(
      actual === undefined
        ? `INSERT INTO emisor_tasa_igv (empresa_id, emisor_id, desde, tasa, creado_en, actualizado_en)
           VALUES ($1, $2, $3::date, $4::numeric, $5, $5) RETURNING id, tasa::text AS tasa`
        : `UPDATE emisor_tasa_igv SET tasa = $4::numeric, actualizado_en = $5
            WHERE emisor_id = $2 AND desde = $3::date AND empresa_id = $1 RETURNING id, tasa::text AS tasa`,
      {
        bind: [this.contexto.empresaActual(), emisorId, desde, entrada.tasa, this.reloj.ahora()],
        type: QueryTypes.SELECT,
      },
    );
    const guardada = guardadas[0]!;
    await this.auditoria.registrar({
      accion: 'configurar_tasa_igv',
      entidad: 'emisor_tasa_igv',
      entidadId: guardada.id,
      detalle: {
        emisorId,
        desde,
        antes: actual?.tasa ?? null,
        despues: guardada.tasa,
      },
    });
    return { desde, tasa: guardada.tasa };
  }

  /**
   * El emisor y la sucursal tal como se guardan en el comprobante (criterio 69). Lo usa el cobro (módulo de caja) y
   * la emisión. 404 si la sucursal no es de la empresa.
   */
  async datosParaComprobante(sucursalId: string): Promise<DatosParaComprobante> {
    const filas = await this.conexion.query<{
      sucursal_id: string;
      nombre: string;
      direccion: string;
      codigo_establecimiento: string;
      emisor_id: string;
      ruc: string;
      razon_social: string;
      regimen: RegimenTributario;
    }>(
      `SELECT s.id AS sucursal_id, s.nombre, s.direccion, s.codigo_establecimiento::text AS codigo_establecimiento,
              e.id AS emisor_id, e.ruc::text AS ruc, e.razon_social, e.regimen
         FROM sucursal s
         JOIN emisor e ON e.id = s.emisor_id AND e.empresa_id = s.empresa_id
        WHERE s.id = $1`,
      { bind: [sucursalId], type: QueryTypes.SELECT },
    );
    const fila = filas[0];
    if (fila === undefined)
      throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La sucursal no existe');
    return {
      sucursal: {
        id: fila.sucursal_id,
        nombre: fila.nombre,
        direccion: fila.direccion,
        codigoEstablecimiento: fila.codigo_establecimiento,
      },
      emisor: {
        id: fila.emisor_id,
        ruc: fila.ruc,
        razonSocial: fila.razon_social,
        regimen: fila.regimen,
      },
    };
  }

  private async leerTasas(emisorId: string): Promise<TasaIgvRespuesta[]> {
    return this.conexion.query<TasaIgvRespuesta>(
      `SELECT to_char(desde, 'YYYY-MM-DD') AS desde, tasa::text AS tasa
         FROM emisor_tasa_igv WHERE emisor_id = $1 ORDER BY desde`,
      { bind: [emisorId], type: QueryTypes.SELECT },
    );
  }

  /**
   * `FOR NO KEY UPDATE` de la fila del emisor, esperando a lo sumo `ESPERA_MAXIMA_DE_COBROS_MS`. La guarda de la API
   * no admite `SET lock_timeout` (ni `SAVEPOINT` para sobrevivir a `NOWAIT`), así que se intenta con `SKIP LOCKED`
   * cada `PAUSA_ENTRE_INTENTOS_MS`: una fila vacía es «bloqueada por un cobro». 404 si el emisor no es de la empresa;
   * pasado el plazo, 409 `CONFLICTO` y la transacción se revierte sin guardar nada.
   */
  private async bloquearEmisorConEspera(emisorId: string): Promise<void> {
    await this.exigirEmisor(emisorId);
    const limite = performance.now() + ESPERA_MAXIMA_DE_COBROS_MS;
    for (;;) {
      const filas = await this.conexion.query<{ id: string }>(
        'SELECT id FROM emisor WHERE id = $1 FOR NO KEY UPDATE SKIP LOCKED',
        { bind: [emisorId], type: QueryTypes.SELECT },
      );
      if (filas.length > 0) return;
      if (performance.now() >= limite) {
        throw new ErrorAplicacion(409, 'CONFLICTO', 'Hay cobros en curso; inténtalo de nuevo');
      }
      await new Promise((resolver) => setTimeout(resolver, PAUSA_ENTRE_INTENTOS_MS));
    }
  }

  private async exigirEmisor(
    emisorId: string,
    bloquear: boolean | 'compartido' = false,
  ): Promise<void> {
    const cerrojo = bloquear === 'compartido' ? ' FOR SHARE' : bloquear ? ' FOR NO KEY UPDATE' : '';
    const filas = await this.conexion.query<{ id: string }>(
      `SELECT id FROM emisor WHERE id = $1${cerrojo}`,
      { bind: [emisorId], type: QueryTypes.SELECT },
    );
    if (filas.length === 0) throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'El emisor no existe');
  }
}
