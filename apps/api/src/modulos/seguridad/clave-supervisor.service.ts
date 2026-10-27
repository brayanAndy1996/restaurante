import { Inject, Injectable } from '@nestjs/common';
import type { AutorizacionEntrada, AutorizacionRespuesta } from '@restaurante/contratos';
import { puedeAutorizar, requisitoPermiso, type Rol } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import {
  CLAVE_HUELLA,
  RETENCION_IDEMPOTENCIA_MS,
  huellaDeEntrada,
} from '../../nucleo/idempotencia';
import type { Principal } from '../../nucleo/principal';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { BloqueosService, segundosHasta, type AmbitoBloqueo } from './bloqueos.service';
import {
  FALLOS_PARA_BLOQUEAR_CLAVE,
  MINUTOS_BLOQUEO_CLAVE,
  MINUTOS_VIGENCIA_AUTORIZACION,
} from './constantes-acceso';
import { Credenciales } from './credenciales';
import { HorarioService } from './horario.service';
import { SesionActual } from './sesion-actual';

const MINUTO_MS = 60_000;
const RUTA = 'POST /autorizaciones';

type Resultado =
  { ok: AutorizacionRespuesta } | { error: ErrorAplicacion; bloqueos?: BloqueoNuevo[] };

/** Un bloqueo que dejó este fallo: se audita en una transacción aparte, con el actor `autenticacion`. */
interface BloqueoNuevo {
  ambito: 'CLAVE_USUARIO' | 'CLAVE_EQUIPO';
  objetivoId: string;
  fallosSeguidos: number;
  bloqueadoHasta: Date;
}

/** Por qué se rechazó un PIN: solo va a la auditoría, nunca a la respuesta (criterios 45 y 110). */
type MotivoRechazo =
  | 'PIN_INEXISTENTE'
  | 'USUARIO_INACTIVO'
  | 'PROPIO_SOLICITANTE'
  | 'SIN_ROL_AUTORIZADOR'
  | 'FUERA_DE_HORARIO';

interface FilaAutorizador {
  id: string;
  nombre: string;
  activo: boolean;
  es_administrador: boolean;
  horario: unknown;
  rol: Exclude<Rol, 'ADMINISTRADOR'> | null;
}

/**
 * Mismo cuerpo para todo PIN rechazado (inexistente, de un usuario sin rol autorizador, inactivo, fuera de
 * su horario, de otra empresa o del propio solicitante): quien ataca no distingue por qué (criterio 45).
 */
const claveInvalida = () => new ErrorAplicacion(403, 'CLAVE_INVALIDA', 'La clave no es válida');

const bloqueoTemporal = (hasta: Date, ahora: Date) =>
  new ErrorAplicacion(
    429,
    'BLOQUEO_TEMPORAL',
    'Demasiados intentos fallidos; intenta de nuevo más tarde',
    undefined,
    segundosHasta(hasta, ahora),
  );

/**
 * Clave de supervisor, primera mitad (HU-03, RF-12, criterios 44 a 47, 52, 53 y 110): `POST /autorizaciones`.
 * Un supervisor escribe su PIN de 6 dígitos en el equipo de quien pide y la API crea una autorización de un
 * solo uso, válida 2 minutos, que `@Permiso` consume después (`AutorizacionService.consumir`).
 *
 * Abre su propia transacción de empresa (`ContextoEmpresa.ejecutar`, con el solicitante y su equipo como
 * actor) y devuelve el error a lanzar: se lanza después de confirmarla, así la cuenta de fallos y la fila de
 * auditoría del rechazo quedan guardadas aunque la respuesta sea un error (criterio 45). Los bloqueos
 * nuevos se auditan en una segunda transacción con el actor `autenticacion` (tabla de acciones auditadas).
 *
 * Los intentos de la misma persona (y del mismo equipo) se atienden de uno en uno: la transacción bloquea la
 * fila del solicitante y la del equipo antes de mirar los bloqueos, así ningún intento concurrente evade el
 * quinto fallo. El PIN nunca se guarda ni se registra: solo se calcula su huella para buscar al supervisor.
 */
@Injectable()
export class ClaveSupervisorService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(Credenciales) private readonly credenciales: Credenciales,
    @Inject(HorarioService) private readonly horario: HorarioService,
    @Inject(BloqueosService) private readonly bloqueos: BloqueosService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(SesionActual) private readonly sesion: SesionActual,
    @Inject(CLAVE_HUELLA) private readonly claveHuella: Buffer,
  ) {}

  /** `claveIdempotencia`: valor ya validado de `Idempotency-Key`, si la petición la trae. */
  async autorizar(
    entrada: AutorizacionEntrada,
    claveIdempotencia?: string,
  ): Promise<AutorizacionRespuesta> {
    const principal = this.sesion.principal();
    // Validaciones previas (criterio 46): no cuentan fallo ni se auditan.
    if (principal.rol === null || principal.sucursalId === null) {
      throw new ErrorAplicacion(409, 'SUCURSAL_NO_ELEGIDA', 'Elige una sucursal para continuar');
    }
    const requisito = requisitoPermiso(principal.rol, entrada.accion);
    if (requisito === 'prohibido') {
      throw new ErrorAplicacion(403, 'PROHIBIDO', 'No tienes permiso para realizar esta operación');
    }
    // Soporte y principal de prueba son Administrador: la acción les es `permitido` (criterio 52).
    if (requisito === 'permitido') {
      throw new ErrorAplicacion(
        409,
        'CLAVE_INNECESARIA',
        'Esta acción no necesita la clave de un supervisor',
      );
    }
    // Con clave, el solicitante es una persona con sesión guardada; si no, no hay a quién autorizar.
    if (principal.usuarioId === null || principal.sesionId === null) {
      throw new ErrorAplicacion(403, 'PROHIBIDO', 'No tienes permiso para realizar esta operación');
    }

    const resultado = await this.contexto.ejecutar(
      principal.empresaId,
      () => this.enContexto(principal, entrada, claveIdempotencia),
      { actor: { usuarioId: principal.usuarioId, equipoId: principal.equipoId } },
    );
    if ('ok' in resultado) return resultado.ok;
    if (resultado.bloqueos !== undefined && resultado.bloqueos.length > 0) {
      await this.auditarBloqueos(principal, resultado.bloqueos);
    }
    throw resultado.error;
  }

  private async enContexto(
    principal: Principal,
    entrada: AutorizacionEntrada,
    claveIdempotencia: string | undefined,
  ): Promise<Resultado> {
    const empresaId = principal.empresaId;
    const solicitanteId = principal.usuarioId!;
    const sucursalId = principal.sucursalId!;

    // Los intentos de esta persona y de este equipo se atienden de uno en uno. `NO KEY UPDATE` no choca
    // con las llaves foráneas que otras transacciones toman sobre estas mismas filas.
    await this.conexion.query('SELECT id FROM usuario WHERE id = $1 FOR NO KEY UPDATE', {
      bind: [solicitanteId],
      type: QueryTypes.SELECT,
    });
    if (principal.equipoId !== null) {
      await this.conexion.query('SELECT id FROM equipo WHERE id = $1 FOR NO KEY UPDATE', {
        bind: [principal.equipoId],
        type: QueryTypes.SELECT,
      });
    }
    const ahora = this.reloj.ahora(); // después de esperar el turno

    // El bloqueo se mira antes que la clave de idempotencia (criterio 47): durante el bloqueo, todo intento
    // con clave —incluida la réplica exacta de uno anterior— responde igual que uno sin clave. Si no, la
    // clave serviría para saber si un PIN es el correcto sin que el intento cuente ni se audite.
    const bloqueoUsuario = await this.bloqueos.estado('CLAVE_USUARIO', solicitanteId, ahora);
    const bloqueoEquipo =
      principal.equipoId === null
        ? { bloqueadoHasta: null }
        : await this.bloqueos.estado('CLAVE_EQUIPO', principal.equipoId, ahora);
    const hasta = [bloqueoUsuario.bloqueadoHasta, bloqueoEquipo.bloqueadoHasta]
      .filter((fecha): fecha is Date => fecha !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (hasta !== undefined) return { error: bloqueoTemporal(hasta, ahora) };

    // Idempotencia (criterio 85): la clave se reserva en esta misma transacción. Sin bloqueo, la clave con
    // otro cuerpo responde 422 sin evaluar el PIN (criterio 86).
    let huellaIdempotencia = '';
    if (claveIdempotencia !== undefined) {
      huellaIdempotencia = huellaDeEntrada(
        this.claveHuella,
        RUTA,
        `usuario:${solicitanteId}`,
        entrada,
      );
      const repetida = await this.reservarClave(
        empresaId,
        claveIdempotencia,
        huellaIdempotencia,
        ahora,
      );
      if (repetida !== null) return repetida;
    }

    const resultado = await this.evaluar(
      principal,
      entrada,
      empresaId,
      solicitanteId,
      sucursalId,
      ahora,
    );
    if (claveIdempotencia !== undefined) {
      if ('ok' in resultado) {
        await this.completarClave(
          empresaId,
          claveIdempotencia,
          huellaIdempotencia,
          resultado.ok,
          ahora,
        );
      } else {
        // La respuesta de error no se guarda: la clave queda libre para reintentar.
        await this.conexion.query('DELETE FROM idempotencia WHERE clave = $1', {
          bind: [claveIdempotencia],
        });
      }
    }
    return resultado;
  }

  private async evaluar(
    principal: Principal,
    entrada: AutorizacionEntrada,
    empresaId: string,
    solicitanteId: string,
    sucursalId: string,
    ahora: Date,
  ): Promise<Resultado> {
    // El bloqueo por solicitante y por equipo ya se miró en `enContexto` (criterio 47).
    const huella = this.credenciales.huellaPin(empresaId, entrada.pin);
    const candidatos = await this.conexion.query<FilaAutorizador>(
      `SELECT u.id, u.nombre, u.activo, u.es_administrador, u.horario, a.rol
         FROM usuario u
         LEFT JOIN acceso_sucursal a
                ON a.usuario_id = u.id AND a.empresa_id = u.empresa_id AND a.sucursal_id = $3
        WHERE u.empresa_id = $1 AND u.huella_pin = $2`,
      { bind: [empresaId, huella, sucursalId], type: QueryTypes.SELECT },
    );
    const autorizador = candidatos[0];
    const motivoRechazo = this.motivoDeRechazo(autorizador, solicitanteId, entrada, ahora);
    if (motivoRechazo !== null) {
      return this.rechazar(principal, entrada, autorizador?.id ?? null, motivoRechazo, ahora);
    }
    return { ok: await this.otorgar(principal, entrada, autorizador!, ahora) };
  }

  /** `null` si el PIN es de alguien que puede autorizar esta acción ahora; si no, el motivo interno. */
  private motivoDeRechazo(
    autorizador: FilaAutorizador | undefined,
    solicitanteId: string,
    entrada: AutorizacionEntrada,
    ahora: Date,
  ): MotivoRechazo | null {
    if (autorizador === undefined) return 'PIN_INEXISTENTE';
    if (!autorizador.activo) return 'USUARIO_INACTIVO';
    if (autorizador.id === solicitanteId) return 'PROPIO_SOLICITANTE';
    const rol: Rol | null = autorizador.es_administrador ? 'ADMINISTRADOR' : autorizador.rol;
    if (rol === null || !puedeAutorizar(rol, entrada.accion)) return 'SIN_ROL_AUTORIZADOR';
    // El horario se mira al final, con el reloj de la API (criterio 110).
    const dentro = this.horario.estaDentro(
      { esAdministrador: autorizador.es_administrador, horario: autorizador.horario },
      ahora,
    );
    return dentro ? null : 'FUERA_DE_HORARIO';
  }

  /** Cuenta el fallo (solicitante y equipo), audita el rechazo y devuelve el error. */
  private async rechazar(
    principal: Principal,
    entrada: AutorizacionEntrada,
    autorizadorId: string | null,
    motivoRechazo: MotivoRechazo,
    ahora: Date,
  ): Promise<Resultado> {
    const opciones = {
      umbral: FALLOS_PARA_BLOQUEAR_CLAVE,
      duracionMs: MINUTOS_BLOQUEO_CLAVE * MINUTO_MS,
    };
    const objetivos: { ambito: AmbitoBloqueo; objetivoId: string }[] = [
      { ambito: 'CLAVE_USUARIO', objetivoId: principal.usuarioId! },
    ];
    if (principal.equipoId !== null) {
      objetivos.push({ ambito: 'CLAVE_EQUIPO', objetivoId: principal.equipoId });
    }
    const bloqueos: BloqueoNuevo[] = [];
    for (const { ambito, objetivoId } of objetivos) {
      const fallo = await this.bloqueos.registrarFallo(ambito, objetivoId, ahora, opciones);
      if (fallo.bloqueoNuevo && fallo.bloqueadoHasta !== null) {
        bloqueos.push({
          ambito: ambito as BloqueoNuevo['ambito'],
          objetivoId,
          fallosSeguidos: fallo.fallosSeguidos,
          bloqueadoHasta: fallo.bloqueadoHasta,
        });
      }
    }
    await this.auditoria.registrar({
      accion: 'autorizacion_rechazada',
      motivo: entrada.motivo,
      detalle: {
        accion: entrada.accion,
        motivoRechazo,
        solicitanteId: principal.usuarioId,
        equipoId: principal.equipoId,
        // A quién pertenece el PIN probado, si pertenece a alguien: ayuda a investigar, nunca se responde.
        autorizadorId,
      },
    });
    return { error: claveInvalida(), bloqueos };
  }

  /** Crea la autorización, reinicia las cuentas de fallos y audita el otorgamiento. */
  private async otorgar(
    principal: Principal,
    entrada: AutorizacionEntrada,
    autorizador: FilaAutorizador,
    ahora: Date,
  ): Promise<AutorizacionRespuesta> {
    const solicitanteId = principal.usuarioId!;
    await this.bloqueos.reiniciar('CLAVE_USUARIO', solicitanteId, ahora);
    if (principal.equipoId !== null)
      await this.bloqueos.reiniciar('CLAVE_EQUIPO', principal.equipoId, ahora);

    const expiraEn = new Date(ahora.getTime() + MINUTOS_VIGENCIA_AUTORIZACION * MINUTO_MS);
    const filas = await this.conexion.query<{ id: string }>(
      `INSERT INTO autorizacion
         (empresa_id, sesion_id, solicitante_id, autorizador_id, sucursal_id, equipo_id, accion, motivo,
          expira_en, creado_en, actualizado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       RETURNING id`,
      {
        bind: [
          principal.empresaId,
          principal.sesionId,
          solicitanteId,
          autorizador.id,
          principal.sucursalId,
          principal.equipoId,
          entrada.accion,
          entrada.motivo,
          expiraEn,
          ahora,
        ],
        type: QueryTypes.SELECT,
      },
    );
    const autorizacionId = filas[0]!.id;
    await this.auditoria.registrar({
      accion: 'autorizacion_otorgada',
      motivo: entrada.motivo,
      entidad: 'autorizacion',
      entidadId: autorizacionId,
      autorizadoPorId: autorizador.id,
      autorizacionId,
      detalle: {
        accion: entrada.accion,
        solicitanteId,
        autorizadorId: autorizador.id,
        equipoId: principal.equipoId,
        expiraEn: expiraEn.toISOString(),
      },
    });
    return {
      autorizacionId,
      accion: entrada.accion,
      autorizadoPor: { id: autorizador.id, nombre: autorizador.nombre },
      expiraEn: expiraEn.toISOString(),
    };
  }

  /**
   * Segunda transacción, con el actor `autenticacion`: una fila `bloqueo_clave` por cada bloqueo que dejó el
   * fallo, con la persona y el equipo afectados en el detalle (nunca el PIN).
   */
  private async auditarBloqueos(principal: Principal, bloqueos: BloqueoNuevo[]): Promise<void> {
    await this.contexto.ejecutar(
      principal.empresaId,
      async () => {
        for (const bloqueo of bloqueos) {
          await this.auditoria.registrar({
            accion: 'bloqueo_clave',
            entidad: bloqueo.ambito === 'CLAVE_EQUIPO' ? 'equipo' : 'usuario',
            entidadId: bloqueo.objetivoId,
            detalle: {
              ambito: bloqueo.ambito,
              solicitanteId: principal.usuarioId,
              equipoId: principal.equipoId,
              fallosSeguidos: bloqueo.fallosSeguidos,
              bloqueadoHasta: bloqueo.bloqueadoHasta.toISOString(),
            },
          });
        }
      },
      { actor: { sistema: 'autenticacion' } },
    );
  }

  // ---- Idempotencia (criterio 85) -----------------------------------------------------------------

  /**
   * Reserva la clave en esta transacción. Devuelve `null` si es nueva; si ya se usó con la misma petición,
   * la respuesta guardada; si se usó con otra, 422 `CLAVE_IDEMPOTENCIA_REUTILIZADA`. Si otra transacción la
   * tiene reservada, el `INSERT` espera a que termine.
   */
  private async reservarClave(
    empresaId: string,
    clave: string,
    huella: string,
    ahora: Date,
  ): Promise<Resultado | null> {
    await this.conexion.query('DELETE FROM idempotencia WHERE creado_en < $1', {
      bind: [new Date(ahora.getTime() - RETENCION_IDEMPOTENCIA_MS)],
    });
    const actor = `usuario:${this.sesion.principal().usuarioId}`;
    const nuevas = await this.conexion.query<{ id: string }>(
      `INSERT INTO idempotencia (empresa_id, clave, ruta, actor, huella_entrada, estado, creado_en)
       VALUES ($1, $2, $3, $4, $5, 'en_curso', $6)
       ON CONFLICT (empresa_id, clave) DO NOTHING
       RETURNING id`,
      { bind: [empresaId, clave, RUTA, actor, huella, ahora], type: QueryTypes.SELECT },
    );
    if (nuevas.length > 0) return null;

    const filas = await this.conexion.query<{
      huella_entrada: string;
      ruta: string;
      actor: string;
      estado: string;
      respuesta: AutorizacionRespuesta;
    }>('SELECT huella_entrada, ruta, actor, estado, respuesta FROM idempotencia WHERE clave = $1', {
      bind: [clave],
      type: QueryTypes.SELECT,
    });
    const fila = filas[0];
    if (
      fila === undefined ||
      fila.huella_entrada !== huella ||
      fila.ruta !== RUTA ||
      fila.actor !== actor
    ) {
      return {
        error: new ErrorAplicacion(
          422,
          'CLAVE_IDEMPOTENCIA_REUTILIZADA',
          'La clave de idempotencia ya se usó con otra petición',
        ),
      };
    }
    if (fila.estado !== 'completada') {
      return {
        error: new ErrorAplicacion(409, 'CONFLICTO', 'La operación con esa clave sigue en curso'),
      };
    }
    return { ok: fila.respuesta };
  }

  /** `idempotencia` no da `UPDATE`: la fila `en_curso` se reemplaza por la `completada` en la misma transacción. */
  private async completarClave(
    empresaId: string,
    clave: string,
    huella: string,
    respuesta: AutorizacionRespuesta,
    ahora: Date,
  ): Promise<void> {
    await this.conexion.query('DELETE FROM idempotencia WHERE clave = $1', { bind: [clave] });
    await this.conexion.query(
      `INSERT INTO idempotencia (empresa_id, clave, ruta, actor, huella_entrada, estado, estado_http,
                                 respuesta, creado_en)
       VALUES ($1, $2, $3, $4, $5, 'completada', 201, $6::jsonb, $7)`,
      {
        bind: [
          empresaId,
          clave,
          RUTA,
          `usuario:${this.sesion.principal().usuarioId}`,
          huella,
          JSON.stringify(respuesta),
          ahora,
        ],
      },
    );
  }
}
