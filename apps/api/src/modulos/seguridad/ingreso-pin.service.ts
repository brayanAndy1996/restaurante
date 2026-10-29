import { Inject, Injectable } from '@nestjs/common';
import type { IngresoPinEntrada, IngresoRespuesta } from '@restaurante/contratos';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { BloqueosService } from './bloqueos.service';
import {
  FALLOS_PARA_BLOQUEAR_PIN,
  FALLOS_PARA_OLVIDAR_PIN,
  HORAS_MAXIMAS_PIN,
  MINUTOS_BLOQUEO_PIN,
  MINUTOS_INACTIVIDAD_PIN_POR_DEFECTO,
} from './constantes-acceso';
import { Credenciales } from './credenciales';
import { bloqueoTemporal } from './errores-acceso';
import { EquiposService, equipoNoReconocido, tokenEquipoDeCabecera } from './equipos.service';
import { DesconexionDeSesiones } from './desconexion-de-sesiones';
import { HorarioService } from './horario.service';
import { minutosDeInactividad } from './inactividad';
import { SesionesService } from './sesiones.service';
import { armarTokenSesion, type TokenEquipo } from './tokens';

const MINUTO_MS = 60_000;
const HORA_MS = 60 * MINUTO_MS;

type Resultado<T> = { ok: T } | { error: ErrorAplicacion };

/**
 * Mismo cuerpo para un PIN que no es el de la persona y para una persona que el equipo no recuerda (criterios
 * 34 y 35): quien ataca no distingue si la persona existe ni si el equipo la recuerda.
 */
const pinRechazado = () =>
  new ErrorAplicacion(401, 'CREDENCIALES_INVALIDAS', 'La persona o el PIN no son correctos');

interface FilaPersonaEnEquipo {
  recordado_id: string;
  ultima_sucursal_id: string | null;
  usuario_id: string;
  nombre: string;
  nombre_usuario: string;
  huella_pin: Buffer;
  contrasena_temporal: boolean;
  horario: unknown;
  es_administrador: boolean;
  activo: boolean;
}

/**
 * Ingreso con PIN en un equipo que ya recuerda a la persona (criterios 33 a 38, 107 y 109, HU-02). La
 * persona se elige (`usuarioId`), el PIN se compara con el suyo y solo vale en equipos donde entró antes con
 * contraseña. Abre su propia transacción (`ContextoEmpresa.ejecutar` con la empresa del token del equipo) y
 * devuelve el error a lanzar: se lanza después de confirmarla, así los fallos, los bloqueos, el olvido del
 * equipo y el rechazo por horario quedan guardados aunque la respuesta sea un error.
 *
 * Las filas del equipo se bloquean (`FOR UPDATE`) al empezar: los intentos del mismo equipo se atienden de
 * uno en uno, así que ningún intento concurrente evade el bloqueo ni el olvido al 15.º fallo, y el cambio
 * rápido de usuario nunca deja dos sesiones PIN abiertas.
 */
@Injectable()
export class IngresoPinService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(Credenciales) private readonly credenciales: Credenciales,
    @Inject(HorarioService) private readonly horario: HorarioService,
    @Inject(BloqueosService) private readonly bloqueos: BloqueosService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(EquiposService) private readonly equipos: EquiposService,
    @Inject(SesionesService) private readonly sesiones: SesionesService,
    @Inject(DesconexionDeSesiones) private readonly desconexion: DesconexionDeSesiones,
  ) {}

  /** `POST /sesiones/pin` con la cabecera `X-Equipo`. */
  async ingresar(cabecera: unknown, entrada: IngresoPinEntrada): Promise<IngresoRespuesta> {
    const token = tokenEquipoDeCabecera(cabecera);
    // Sin equipo válido no se evalúa el PIN ni se cuenta nada (criterio 34).
    if (token === null) throw equipoNoReconocido();
    const resultado = await this.contexto.ejecutar(token.empresaId, () =>
      this.ingresoEnContexto(token, entrada),
    );
    if ('error' in resultado) throw resultado.error;
    return resultado.ok;
  }

  private async ingresoEnContexto(
    token: TokenEquipo,
    entrada: IngresoPinEntrada,
  ): Promise<Resultado<IngresoRespuesta>> {
    const empresaId = token.empresaId;

    const equipo = await this.equipos.equipoDelToken(token);
    if (equipo === null) return { error: equipoNoReconocido() };

    // Los intentos de este equipo se atienden de uno en uno.
    await this.conexion.query('SELECT id FROM equipo WHERE id = $1 FOR UPDATE', {
      bind: [equipo.id],
      type: QueryTypes.SELECT,
    });
    const ahora = this.reloj.ahora(); // después de esperar el turno

    const personas = await this.conexion.query<FilaPersonaEnEquipo>(
      `SELECT er.id AS recordado_id, er.ultima_sucursal_id, u.id AS usuario_id, u.nombre, u.nombre_usuario,
              u.huella_pin, u.contrasena_temporal, u.horario, u.es_administrador, u.activo
         FROM equipo_recordado er
         JOIN usuario u ON u.id = er.usuario_id AND u.empresa_id = er.empresa_id
        WHERE er.equipo_id = $1 AND er.usuario_id = $2 AND er.revocado_en IS NULL`,
      { bind: [equipo.id, entrada.usuarioId.toLowerCase()], type: QueryTypes.SELECT },
    );
    const persona = personas[0];
    // Una persona que el equipo no recuerda (nunca entró con contraseña, o fue revocada, olvidada o
    // reemplazada; de otra empresa o inexistente) se rechaza como un PIN malo, sin evaluar ni contar.
    if (persona === undefined) return { error: pinRechazado() };

    const bloqueo = await this.bloqueos.estado('PIN_EQUIPO_RECORDADO', persona.recordado_id, ahora);
    if (bloqueo.bloqueadoHasta !== null) {
      return { error: bloqueoTemporal(bloqueo.bloqueadoHasta, ahora) };
    }

    const correcto = this.credenciales.pinCoincide(empresaId, entrada.pin, persona.huella_pin);
    if (!correcto) {
      await this.contexto.fijarActor({ sistema: 'autenticacion' });
      await this.contarFallo(equipo.id, persona);
      return { error: pinRechazado() };
    }
    // Defensa en profundidad: con el equipo recordado activo, la persona no debería estar inactiva ni con
    // contraseña temporal (lo impide el criterio 32b); si lo estuviera, el PIN correcto tampoco entra.
    if (!persona.activo || persona.contrasena_temporal) {
      await this.contexto.fijarActor({ sistema: 'autenticacion' });
      return { error: pinRechazado() };
    }

    // PIN correcto: de aquí en adelante lo que se escribe queda a nombre de la persona y de este equipo.
    await this.contexto.fijarActor({ usuarioId: persona.usuario_id, equipoId: equipo.id });
    await this.bloqueos.reiniciar('PIN_EQUIPO_RECORDADO', persona.recordado_id, ahora);

    // El horario se mira después del PIN y del bloqueo (criterio 107): no cuenta como fallo.
    if (
      !this.horario.estaDentro(
        { esAdministrador: persona.es_administrador, horario: persona.horario },
        ahora,
      )
    ) {
      await this.auditoria.registrar({
        accion: 'ingreso_fuera_de_horario',
        entidad: 'usuario',
        entidadId: persona.usuario_id,
        detalle: {
          usuarioId: persona.usuario_id,
          nombreUsuario: persona.nombre_usuario,
          equipoId: equipo.id,
          via: 'PIN',
        },
      });
      return {
        error: new ErrorAplicacion(
          403,
          'FUERA_DE_HORARIO',
          'Estás fuera de tu horario de acceso; vuelve a intentar dentro de él',
        ),
      };
    }

    // Cambio rápido de usuario: un equipo tiene como máximo una sesión PIN abierta (criterio 38).
    const anteriores = await this.conexion.query<{ id: string }>(
      `UPDATE sesion SET cerrada_en = $2, motivo_cierre = 'CAMBIO_DE_USUARIO', actualizado_en = $2
        WHERE equipo_id = $1 AND tipo = 'PIN' AND cerrada_en IS NULL
        RETURNING id`,
      { bind: [equipo.id, ahora], type: QueryTypes.SELECT },
    );
    // La conexión de tiempo real de la persona anterior se cierra al confirmar (historia 004, criterio 66).
    this.desconexion.alConfirmar(anteriores.map((a) => a.id));

    // Sucursal inicial (criterio 33): la única a la que tiene acceso o, si tiene varias, la última que
    // eligió en este equipo mientras siga teniendo acceso; si no, ninguna.
    const elegibles = await this.sesiones.sucursalesElegibles(
      persona.usuario_id,
      persona.es_administrador,
    );
    const sucursalId =
      elegibles.length === 1
        ? elegibles[0]!.id
        : (elegibles.find((s) => s.id === persona.ultima_sucursal_id)?.id ?? null);
    // La columna `minutos_inactividad` guarda los de la sucursal (1 a 120); el tiempo de Cocina/Barra se decide
    // al validar (criterio 63b), y aquí solo se usa para el vencimiento que devuelve el ingreso.
    const delAcceso = await this.sesiones.minutosDeSucursal(sucursalId);
    const minutos = delAcceso.minutosSucursal ?? MINUTOS_INACTIVIDAD_PIN_POR_DEFECTO;
    const minutosQueRigen = minutosDeInactividad({
      tipo: 'PIN',
      rol: elegibles.find((s) => s.id === sucursalId)?.rol ?? null,
      ...delAcceso,
      minutosSesion: minutos,
    });

    const secreto = this.credenciales.generarSecreto();
    const expira = new Date(ahora.getTime() + HORAS_MAXIMAS_PIN * HORA_MS);
    const filas = await this.conexion.query<{ id: string }>(
      `INSERT INTO sesion (empresa_id, tipo, usuario_id, equipo_id, equipo_recordado_id, sucursal_id,
                           huella_secreto, ultima_actividad_en, expira_en, minutos_inactividad,
                           creado_en, actualizado_en)
       VALUES ($1, 'PIN', $2, $3, $4, $5, $6, $7, $8, $9, $7, $7)
       RETURNING id`,
      {
        bind: [
          empresaId,
          persona.usuario_id,
          equipo.id,
          persona.recordado_id,
          sucursalId,
          this.credenciales.huellaSecreto(secreto),
          ahora,
          expira,
          minutos,
        ],
        type: QueryTypes.SELECT,
      },
    );

    // Último uso de la persona en el equipo y del equipo.
    await this.conexion.query(
      'UPDATE equipo_recordado SET ultimo_uso_en = $2, actualizado_en = $2 WHERE id = $1',
      { bind: [persona.recordado_id, ahora] },
    );
    await this.conexion.query(
      'UPDATE equipo SET ultimo_uso_en = $2, actualizado_en = $2 WHERE id = $1',
      { bind: [equipo.id, ahora] },
    );

    const sesion = await this.sesiones.armarRespuesta({
      tipo: 'PIN',
      empresaId,
      usuario: {
        id: persona.usuario_id,
        nombre: persona.nombre,
        nombreUsuario: persona.nombre_usuario,
      },
      superadministrador: null,
      esAdministrador: persona.es_administrador,
      sucursalId,
      elegibles,
      debeCambiarContrasena: false,
      expiraPorInactividadEn: new Date(ahora.getTime() + minutosQueRigen * MINUTO_MS),
      equipo: { id: equipo.id, nombre: equipo.nombre, equipoRecordadoId: persona.recordado_id },
    });
    return { ok: { token: armarTokenSesion(empresaId, filas[0]!.id, secreto), sesion } };
  }

  /**
   * Cuenta un fallo de (equipo, persona) (criterio 36): el 5.º y el 10.º seguidos bloquean 5 minutos; el
   * 15.º hace que el equipo deje de recordar a la persona (motivo `BLOQUEO`, sus sesiones asociadas se
   * cierran). Todo con el actor `autenticacion` y con su fila de auditoría.
   */
  private async contarFallo(equipoId: string, persona: FilaPersonaEnEquipo): Promise<void> {
    const ahora = this.reloj.ahora();
    const fallo = await this.bloqueos.registrarFalloAcumulado(
      'PIN_EQUIPO_RECORDADO',
      persona.recordado_id,
      ahora,
      {
        cada: FALLOS_PARA_BLOQUEAR_PIN,
        maximo: FALLOS_PARA_OLVIDAR_PIN,
        duracionMs: MINUTOS_BLOQUEO_PIN * MINUTO_MS,
      },
    );
    const detalle = {
      usuarioId: persona.usuario_id,
      nombreUsuario: persona.nombre_usuario,
      equipoId,
      equipoRecordadoId: persona.recordado_id,
      fallosSeguidos: fallo.fallosSeguidos,
    };
    if (fallo.agotado) {
      const revocados = await this.equipos.revocarPorId(persona.recordado_id, 'BLOQUEO', ahora);
      if (revocados.length > 0) {
        await this.auditoria.registrar({
          accion: 'equipo_olvidado_por_bloqueo',
          entidad: 'equipo',
          entidadId: equipoId,
          detalle,
        });
      }
      // La persona tiene que volver a entrar con contraseña: un equipo recordado nuevo cuenta desde cero.
      await this.bloqueos.reiniciar('PIN_EQUIPO_RECORDADO', persona.recordado_id);
    } else if (fallo.bloqueadoHasta !== null) {
      await this.auditoria.registrar({
        accion: 'bloqueo_pin',
        entidad: 'equipo',
        entidadId: equipoId,
        detalle: { ...detalle, bloqueadoHasta: fallo.bloqueadoHasta.toISOString() },
      });
    }
  }
}
