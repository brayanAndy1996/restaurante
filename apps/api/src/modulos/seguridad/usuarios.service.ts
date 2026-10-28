import { Inject, Injectable } from '@nestjs/common';
import {
  minusculasAscii,
  type UsuarioCrearEntrada,
  type UsuarioCreadoRespuesta,
  type UsuarioModificadoRespuesta,
  type UsuarioModificarEntrada,
  type UsuarioRespuesta,
} from '@restaurante/contratos';
import { largoPin, type LargoPin, type RolDeAcceso, type TramoHorario } from '@restaurante/dominio';
import { QueryTypes, type Sequelize } from 'sequelize';
import { CONEXION_API, SQLSTATE, restriccionDe, sqlstateDe } from '../../nucleo/base-de-datos';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import { AuditoriaService } from '../auditoria';
import { Credenciales } from './credenciales';
import { EquiposService, type EquipoRevocado } from './equipos.service';
import { TopeDeIntentos, claveDeIngresoUsuario } from './tope-de-intentos';

interface FilaUsuario {
  id: string;
  nombre: string;
  nombre_usuario: string;
  es_administrador: boolean;
  activo: boolean;
  horario: TramoHorario[] | null;
  largo_pin: LargoPin;
  contrasena_temporal: boolean;
  creado_en: Date;
  actualizado_en: Date;
}

interface Acceso {
  sucursalId: string;
  rol: RolDeAcceso;
}

const COLUMNAS = `u.id, u.nombre, u.nombre_usuario, u.es_administrador, u.activo, u.horario,
  u.largo_pin, u.contrasena_temporal, u.creado_en, u.actualizado_en`;

const noEncontrado = () => new ErrorAplicacion(404, 'NO_ENCONTRADO', 'El usuario no existe');

const sucursalInvalida = () =>
  new ErrorAplicacion(422, 'SUCURSAL_INVALIDA', 'Una de las sucursales no existe en la empresa');

const datosInvalidos = (campo: string, mensaje: string) =>
  new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'Los datos enviados no son válidos', [
    { campo, mensaje },
  ]);

/** Mismo texto para un nombre repetido en la misma empresa o en otra: no dice de cuál es. */
const nombreNoDisponible = () =>
  new ErrorAplicacion(409, 'CONFLICTO', 'El nombre de usuario no está disponible');

const mismoJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Usuarios y accesos de la empresa del contexto activo (RF-08, criterios 18 a 26): corre dentro de la
 * transacción de la petición, con el actor de la sesión, así que la trazabilidad y la auditoría salen del
 * mismo contexto. Solo el Administrador llega aquí (`@SoloAdministrador()` en el controlador). Nunca
 * devuelve hashes ni huellas; el PIN sale solo en la respuesta que lo crea.
 */
@Injectable()
export class UsuariosService {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(Credenciales) private readonly credenciales: Credenciales,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(EquiposService) private readonly equipos: EquiposService,
    @Inject(TopeDeIntentos) private readonly tope: TopeDeIntentos,
  ) {}

  // ---- Consulta --------------------------------------------------------------------------------

  async listar(): Promise<UsuarioRespuesta[]> {
    const filas = await this.conexion.query<FilaUsuario>(
      `SELECT ${COLUMNAS} FROM usuario u ORDER BY u.creado_en, u.id`,
      { type: QueryTypes.SELECT },
    );
    return this.aRespuestas(filas);
  }

  async obtener(id: string): Promise<UsuarioRespuesta> {
    const filas = await this.conexion.query<FilaUsuario>(
      `SELECT ${COLUMNAS} FROM usuario u WHERE u.id = $1`,
      { bind: [id], type: QueryTypes.SELECT },
    );
    if (filas[0] === undefined) throw noEncontrado();
    return (await this.aRespuestas(filas))[0]!;
  }

  // ---- Alta ------------------------------------------------------------------------------------

  /** `POST /usuarios` (criterios 18 a 21): crea al usuario con su PIN (único, del largo de sus roles). */
  async crear(entrada: UsuarioCrearEntrada): Promise<UsuarioCreadoRespuesta> {
    const empresaId = this.contexto.empresaActual();
    const nombreUsuario = minusculasAscii(entrada.nombreUsuario);
    const horario = entrada.horario ?? null;
    const accesos = this.accesosNormalizados(entrada.accesos);
    await this.exigirSucursalesDeLaEmpresa(accesos.map((a) => a.sucursalId));

    const largo = largoPin({
      esAdministrador: entrada.esAdministrador,
      roles: accesos.map((a) => a.rol),
    });
    const { pin, huella } = await this.generarPin(empresaId, largo);
    const hash = await this.credenciales.hashContrasena(entrada.contrasenaTemporal);
    const ahora = this.reloj.ahora();

    let id: string;
    try {
      const filas = await this.conexion.query<{ id: string }>(
        `INSERT INTO usuario (empresa_id, nombre, nombre_usuario, hash_contrasena, contrasena_temporal,
                              huella_pin, largo_pin, horario, es_administrador, activo, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, true, $5, $6, $7::jsonb, $8, true, $9, $9)
         RETURNING id`,
        {
          bind: [
            empresaId,
            entrada.nombre,
            nombreUsuario,
            hash,
            huella,
            largo,
            horario === null ? null : JSON.stringify(horario),
            entrada.esAdministrador,
            ahora,
          ],
          type: QueryTypes.SELECT,
        },
      );
      id = filas[0]!.id;
    } catch (error) {
      throw this.traducirUnicidad(error);
    }
    this.olvidarIngresosRecientes(nombreUsuario); // el nombre ya tiene cuenta activa
    for (const acceso of accesos) {
      await this.conexion.query(
        `INSERT INTO acceso_sucursal (empresa_id, usuario_id, sucursal_id, rol, creado_en, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        { bind: [empresaId, id, acceso.sucursalId, acceso.rol, ahora] },
      );
    }

    await this.auditoria.registrar({
      accion: 'crear_usuario',
      entidad: 'usuario',
      entidadId: id,
      detalle: {
        nombre: entrada.nombre,
        nombreUsuario,
        esAdministrador: entrada.esAdministrador,
        accesos,
        horario,
        largoPin: largo,
      },
    });
    return { ...(await this.obtener(id)), pin };
  }

  // ---- Edición ---------------------------------------------------------------------------------

  /**
   * `PATCH /usuarios/:id` (criterios 21b, 22, 106): reemplaza lo enviado. Si cambia el largo del PIN que
   * dan sus roles, genera uno nuevo en la misma transacción y lo devuelve (única vez que se muestra).
   * Desactivar cierra todas sus sesiones. Quitar el acceso a una sucursal cierra las sesiones que la
   * tenían activa. No se puede dejar a la empresa sin Administrador activo.
   */
  async modificar(
    id: string,
    cambios: UsuarioModificarEntrada,
  ): Promise<UsuarioModificadoRespuesta> {
    const empresaId = this.contexto.empresaActual();
    // Siempre en el mismo orden (primero los Administradores activos por id, después el usuario): dos
    // cambios concurrentes que quitan a los dos únicos Administradores se serializan y no se bloquean
    // entre sí.
    await this.conexion.query(
      'SELECT id FROM usuario WHERE es_administrador AND activo ORDER BY id FOR UPDATE',
    );
    const actual = await this.bloquearUsuario(id);
    const accesosActuales = (await this.accesosPorUsuario([id])).get(id) ?? [];

    const esAdministrador = cambios.esAdministrador ?? actual.es_administrador;
    const activo = cambios.activo ?? actual.activo;
    const horario = cambios.horario !== undefined ? cambios.horario : actual.horario;
    const nombre = cambios.nombre ?? actual.nombre;
    let accesos = this.accesosNormalizados(cambios.accesos ?? accesosActuales);

    if (esAdministrador) {
      if (cambios.accesos !== undefined && accesos.length > 0) {
        throw datosInvalidos('accesos', 'Un Administrador no lleva accesos por sucursal');
      }
      if (horario !== null) {
        throw datosInvalidos(
          'horario',
          'Un Administrador no puede tener horario; envía horario: null para quitarlo',
        );
      }
      accesos = [];
    } else if (accesos.length === 0) {
      throw datosInvalidos('accesos', 'Debe tener al menos un acceso a una sucursal');
    }
    if (cambios.accesos !== undefined) {
      await this.exigirSucursalesDeLaEmpresa(accesos.map((a) => a.sucursalId));
    }

    // No se deja a la empresa sin Administrador activo (los Administradores ya están bloqueados arriba).
    if (actual.es_administrador && actual.activo && (!esAdministrador || !activo)) {
      const otros = await this.conexion.query<{ id: string }>(
        `SELECT id FROM usuario WHERE es_administrador AND activo AND id <> $1`,
        { bind: [id], type: QueryTypes.SELECT },
      );
      if (otros.length === 0) {
        throw new ErrorAplicacion(
          409,
          'ULTIMO_ADMINISTRADOR',
          'La empresa debe conservar al menos un Administrador activo',
        );
      }
    }

    const largo = largoPin({ esAdministrador, roles: accesos.map((a) => a.rol) });
    const cambiaElLargo = largo !== actual.largo_pin;
    const nuevoPin = cambiaElLargo ? await this.generarPin(empresaId, largo) : null;
    const ahora = this.reloj.ahora();

    await this.conexion.query(
      `UPDATE usuario
          SET nombre = $2, es_administrador = $3, activo = $4, horario = $5::jsonb,
              huella_pin = COALESCE($6, huella_pin), largo_pin = $7, actualizado_en = $8
        WHERE id = $1`,
      {
        bind: [
          id,
          nombre,
          esAdministrador,
          activo,
          horario === null ? null : JSON.stringify(horario),
          nuevoPin?.huella ?? null,
          largo,
          ahora,
        ],
      },
    );

    const huboCambioDeAccesos = !mismoJson(this.ordenar(accesos), this.ordenar(accesosActuales));
    if (huboCambioDeAccesos)
      await this.reemplazarAccesos(empresaId, id, accesosActuales, accesos, ahora);

    if (!actual.activo && activo) this.olvidarIngresosRecientes(actual.nombre_usuario); // reactivado

    // Sesiones que ya no valen: cierre inmediato (la guarda también lo comprueba en cada petición).
    if (actual.activo && !activo) {
      await this.cerrarSesiones(id, 'USUARIO_DESACTIVADO', ahora);
    } else if (huboCambioDeAccesos && !esAdministrador) {
      await this.conexion.query(
        `UPDATE sesion SET cerrada_en = $3, motivo_cierre = 'ACCESO_QUITADO', actualizado_en = $3
          WHERE usuario_id = $1 AND cerrada_en IS NULL AND sucursal_id IS NOT NULL
            AND NOT (sucursal_id = ANY($2::uuid[]))`,
        { bind: [id, accesos.map((a) => a.sucursalId), ahora] },
      );
    }
    if (nuevoPin !== null) await this.cerrarSesiones(id, 'PIN_REGENERADO', ahora, 'PIN');

    // Desactivar revoca todos sus equipos recordados en la misma transacción (criterio 32b); reactivarlo no
    // los recupera.
    const equiposRevocados =
      actual.activo && !activo ? await this.equipos.revocarDeUsuario(id, 'DESACTIVADO', ahora) : [];
    await this.auditoria.registrar({
      accion: 'modificar_usuario',
      entidad: 'usuario',
      entidadId: id,
      detalle: {
        ...this.detalleDeCambios(
          { ...actual, accesos: accesosActuales },
          { nombre, esAdministrador, activo, horario, accesos, largo },
          nuevoPin !== null,
        ),
        ...(equiposRevocados.length > 0
          ? { equiposRevocados: this.paraAuditoria(equiposRevocados) }
          : {}),
      },
    });
    if (nuevoPin !== null) {
      await this.auditoria.registrar({
        accion: 'regenerar_pin',
        entidad: 'usuario',
        entidadId: id,
        motivo: 'Cambio del largo del PIN por sus roles',
        detalle: { usuarioId: id, largoPin: { antes: actual.largo_pin, despues: largo } },
      });
    }
    return { ...(await this.obtener(id)), ...(nuevoPin === null ? {} : { pin: nuevoPin.pin }) };
  }

  /** `POST /usuarios/:id/pin` (criterio 21): PIN nuevo del largo vigente; el anterior deja de servir. */
  async regenerarPin(id: string): Promise<{ pin: string }> {
    const empresaId = this.contexto.empresaActual();
    const usuario = await this.bloquearUsuario(id);
    const accesos = (await this.accesosPorUsuario([id])).get(id) ?? [];
    const largo = largoPin({
      esAdministrador: usuario.es_administrador,
      roles: accesos.map((a) => a.rol),
    });
    const { pin, huella } = await this.generarPin(empresaId, largo);
    const ahora = this.reloj.ahora();
    await this.conexion.query(
      'UPDATE usuario SET huella_pin = $2, largo_pin = $3, actualizado_en = $4 WHERE id = $1',
      { bind: [id, huella, largo, ahora] },
    );
    // Las sesiones PIN se cierran; las de contraseña y los equipos recordados se conservan.
    await this.cerrarSesiones(id, 'PIN_REGENERADO', ahora, 'PIN');
    await this.auditoria.registrar({
      accion: 'regenerar_pin',
      entidad: 'usuario',
      entidadId: id,
      detalle: { usuarioId: id, largoPin: largo },
    });
    return { pin };
  }

  /**
   * `POST /usuarios/:id/contrasena` (criterio 23): contraseña temporal nueva; cierra todas las sesiones
   * del usuario y revoca todos sus equipos recordados (criterio 32b): la persona vuelve a entrar con la
   * contraseña temporal en cada equipo.
   */
  async restablecerContrasena(id: string, contrasenaTemporal: string): Promise<void> {
    const hash = await this.credenciales.hashContrasena(contrasenaTemporal);
    const actual = await this.bloquearUsuario(id);
    const ahora = this.reloj.ahora();
    await this.conexion.query(
      `UPDATE usuario SET hash_contrasena = $2, contrasena_temporal = true, actualizado_en = $3
        WHERE id = $1`,
      { bind: [id, hash, ahora] },
    );
    this.olvidarIngresosRecientes(actual.nombre_usuario);
    await this.cerrarSesiones(id, 'CONTRASENA_RESTABLECIDA', ahora);
    const equiposRevocados = await this.equipos.revocarDeUsuario(
      id,
      'CONTRASENA_RESTABLECIDA',
      ahora,
    );
    await this.auditoria.registrar({
      accion: 'restablecer_contrasena',
      entidad: 'usuario',
      entidadId: id,
      detalle: {
        usuarioId: id,
        ...(equiposRevocados.length > 0
          ? { equiposRevocados: this.paraAuditoria(equiposRevocados) }
          : {}),
      },
    });
  }

  // ---- Apoyo -----------------------------------------------------------------------------------

  /**
   * Los topes en memoria recuerdan unos segundos, en plena ráfaga, que un nombre no tiene cuenta (o tiene un
   * bloqueo). Cuando el nombre pasa a tener cuenta activa o cambia su contraseña, se olvida después de
   * confirmar la transacción, para que el siguiente ingreso consulte la base.
   */
  private olvidarIngresosRecientes(nombreUsuario: string): void {
    this.contexto.alConfirmar(() => this.tope.olvidar(claveDeIngresoUsuario(nombreUsuario)));
  }

  /** Fila del usuario bloqueada para la transacción (los cambios de un usuario se serializan); 404 si no está. */
  private async bloquearUsuario(id: string): Promise<FilaUsuario> {
    const filas = await this.conexion.query<FilaUsuario>(
      `SELECT ${COLUMNAS} FROM usuario u WHERE u.id = $1 FOR UPDATE`,
      { bind: [id], type: QueryTypes.SELECT },
    );
    if (filas[0] === undefined) throw noEncontrado();
    return filas[0];
  }

  private async generarPin(
    empresaId: string,
    largo: LargoPin,
  ): Promise<{ pin: string; huella: Buffer }> {
    return this.credenciales.generarPinUnico(empresaId, largo, async (huella) => {
      const filas = await this.conexion.query<{ existe: number }>(
        'SELECT 1 AS existe FROM usuario WHERE huella_pin = $1',
        { bind: [huella], type: QueryTypes.SELECT },
      );
      return filas.length > 0;
    });
  }

  /** Falla con 422 `SUCURSAL_INVALIDA` (idéntico) si alguna sucursal no se ve en la empresa del contexto. */
  private async exigirSucursalesDeLaEmpresa(ids: string[]): Promise<void> {
    const unicas = [...new Set(ids)];
    if (unicas.length === 0) return;
    const filas = await this.conexion.query<{ id: string }>(
      'SELECT id FROM sucursal WHERE id = ANY($1::uuid[])',
      { bind: [unicas], type: QueryTypes.SELECT },
    );
    if (filas.length !== unicas.length) throw sucursalInvalida();
  }

  private traducirUnicidad(error: unknown): unknown {
    if (sqlstateDe(error) !== SQLSTATE.VIOLACION_UNICIDAD) return error;
    if (restriccionDe(error) === 'usuario_pin_unico') {
      return new ErrorAplicacion(
        409,
        'CONFLICTO',
        'No se pudo asignar un PIN; vuelve a intentarlo',
      );
    }
    return nombreNoDisponible();
  }

  private accesosNormalizados(accesos: readonly Acceso[]): Acceso[] {
    return accesos.map((a) => ({ sucursalId: a.sucursalId.toLowerCase(), rol: a.rol }));
  }

  private ordenar(accesos: readonly Acceso[]): Acceso[] {
    return [...accesos].sort((a, b) => a.sucursalId.localeCompare(b.sucursalId));
  }

  /** Cambia los accesos al mínimo: agrega los nuevos, cambia el rol de los que lo cambian y quita el resto. */
  private async reemplazarAccesos(
    empresaId: string,
    usuarioId: string,
    actuales: Acceso[],
    nuevos: Acceso[],
    ahora: Date,
  ): Promise<void> {
    const rolActual = new Map(actuales.map((a) => [a.sucursalId, a.rol]));
    const sucursalesNuevas = new Set(nuevos.map((a) => a.sucursalId));
    const quitadas = actuales.filter((a) => !sucursalesNuevas.has(a.sucursalId));
    if (quitadas.length > 0) {
      await this.conexion.query(
        'DELETE FROM acceso_sucursal WHERE usuario_id = $1 AND sucursal_id = ANY($2::uuid[])',
        { bind: [usuarioId, quitadas.map((a) => a.sucursalId)] },
      );
    }
    for (const acceso of nuevos) {
      const anterior = rolActual.get(acceso.sucursalId);
      if (anterior === undefined) {
        await this.conexion.query(
          `INSERT INTO acceso_sucursal (empresa_id, usuario_id, sucursal_id, rol, creado_en, actualizado_en)
           VALUES ($1, $2, $3, $4, $5, $5)`,
          { bind: [empresaId, usuarioId, acceso.sucursalId, acceso.rol, ahora] },
        );
      } else if (anterior !== acceso.rol) {
        await this.conexion.query(
          `UPDATE acceso_sucursal SET rol = $3, actualizado_en = $4
            WHERE usuario_id = $1 AND sucursal_id = $2`,
          { bind: [usuarioId, acceso.sucursalId, acceso.rol, ahora] },
        );
      }
    }
  }

  /** Cierra las sesiones abiertas del usuario (de un solo tipo si se indica). */
  private async cerrarSesiones(
    usuarioId: string,
    motivo: string,
    ahora: Date,
    tipo?: 'PIN' | 'CONTRASENA',
  ): Promise<void> {
    await this.conexion.query(
      `UPDATE sesion SET cerrada_en = $3, motivo_cierre = $2, actualizado_en = $3
        WHERE usuario_id = $1 AND cerrada_en IS NULL AND ($4::text IS NULL OR tipo = $4)`,
      { bind: [usuarioId, motivo, ahora, tipo ?? null] },
    );
  }

  /** Antes y después de los campos que cambiaron, sin secretos (criterio 26). */
  private detalleDeCambios(
    antes: FilaUsuario & { accesos: Acceso[] },
    despues: {
      nombre: string;
      esAdministrador: boolean;
      activo: boolean;
      horario: TramoHorario[] | null;
      accesos: Acceso[];
      largo: LargoPin;
    },
    pinRegenerado: boolean,
  ): Record<string, unknown> {
    const previo: Record<string, unknown> = {};
    const nuevo: Record<string, unknown> = {};
    const comparar = (campo: string, a: unknown, d: unknown) => {
      if (!mismoJson(a, d)) {
        previo[campo] = a;
        nuevo[campo] = d;
      }
    };
    comparar('nombre', antes.nombre, despues.nombre);
    comparar('esAdministrador', antes.es_administrador, despues.esAdministrador);
    comparar('activo', antes.activo, despues.activo);
    comparar('horario', antes.horario, despues.horario);
    comparar('accesos', this.ordenar(antes.accesos), this.ordenar(despues.accesos));
    comparar('largoPin', antes.largo_pin, despues.largo);
    return { usuarioId: antes.id, antes: previo, despues: nuevo, pinRegenerado };
  }

  private async accesosPorUsuario(ids: string[]): Promise<Map<string, Acceso[]>> {
    const filas = await this.conexion.query<{
      usuario_id: string;
      sucursal_id: string;
      rol: RolDeAcceso;
    }>(
      `SELECT a.usuario_id, a.sucursal_id, a.rol
         FROM acceso_sucursal a
         JOIN sucursal s ON s.id = a.sucursal_id AND s.empresa_id = a.empresa_id
        WHERE a.usuario_id = ANY($1::uuid[])
        ORDER BY s.nombre, s.id`,
      { bind: [ids], type: QueryTypes.SELECT },
    );
    const porUsuario = new Map<string, Acceso[]>();
    for (const fila of filas) {
      const lista = porUsuario.get(fila.usuario_id) ?? [];
      lista.push({ sucursalId: fila.sucursal_id, rol: fila.rol });
      porUsuario.set(fila.usuario_id, lista);
    }
    return porUsuario;
  }

  /** Qué equipos dejaron de recordar a la persona, sin tokens, para el detalle de la auditoría. */
  private paraAuditoria(revocados: EquipoRevocado[]) {
    return revocados.map((r) => ({
      equipoRecordadoId: r.equipoRecordadoId,
      equipoId: r.equipoId,
    }));
  }

  private async aRespuestas(filas: FilaUsuario[]): Promise<UsuarioRespuesta[]> {
    const ids = filas.map((f) => f.id);
    const accesos = await this.accesosPorUsuario(ids);
    const equipos = await this.equipos.contarActivosPorUsuario(ids);
    return filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      nombreUsuario: f.nombre_usuario,
      esAdministrador: f.es_administrador,
      accesos: accesos.get(f.id) ?? [],
      activo: f.activo,
      horario: f.horario,
      largoPin: f.largo_pin,
      contrasenaTemporal: f.contrasena_temporal,
      equiposRecordados: equipos.get(f.id) ?? 0,
      creadoEn: f.creado_en.toISOString(),
      actualizadoEn: f.actualizado_en.toISOString(),
    }));
  }
}
