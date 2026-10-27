import { Inject, Injectable } from '@nestjs/common';
import { horarioUsuarioSchema, type HorarioUsuario } from '@restaurante/contratos';
import { dentroDeHorario, type TramoHorario } from '@restaurante/dominio';
import { RELOJ, type Reloj } from '../../nucleo/reloj';

/** Lo que `HorarioService` necesita de un usuario. */
export interface UsuarioConHorario {
  esAdministrador: boolean;
  /** Tramos semanales (como se guardan en `usuario.horario`), o `null` si no tiene horario. */
  horario: unknown;
}

/**
 * Horario de acceso por trabajador (criterios 105 a 112): decide si una persona puede iniciar sesión o
 * autorizar como supervisor en este momento, con la hora de Lima del reloj de la API (aunque el servidor o
 * la base estén en otra zona horaria). La regla pura es `dentroDeHorario` de `packages/dominio`.
 *
 * Se consulta siempre después de las credenciales (ingreso con contraseña, ingreso con PIN y PIN del
 * autorizador en `POST /autorizaciones`), nunca al validar una sesión abierta ni al cambiar de sucursal
 * (criterio 108): una sesión abierta sigue después de terminar el horario.
 */
@Injectable()
export class HorarioService {
  constructor(@Inject(RELOJ) private readonly reloj: Reloj) {}

  /**
   * `true` si la persona puede entrar (o autorizar) en `instante` (por defecto, ahora según el reloj de la
   * API). El Administrador, la sesión de soporte, el principal de prueba y quien no tiene horario entran a
   * cualquier hora; un horario guardado que no se pueda leer deja fuera (falla cerrada).
   */
  estaDentro(usuario: UsuarioConHorario, instante: Date = this.reloj.ahora()): boolean {
    if (usuario.esAdministrador) return true;
    const tramos = this.tramosDe(usuario.horario);
    if (tramos === undefined) return false;
    return dentroDeHorario(tramos, instante);
  }

  /**
   * Valida un horario recibido (criterio 106): lista de al menos un tramo sin solapes (con
   * `validarHorario` de 001) o `null` para quitarlo. Devuelve los tramos o el error de validación.
   */
  validar(
    horario: unknown,
  ): { valido: true; horario: HorarioUsuario } | { valido: false; campos: string[] } {
    const resultado = horarioUsuarioSchema.safeParse(horario);
    if (resultado.success) return { valido: true, horario: resultado.data };
    return { valido: false, campos: resultado.error.issues.map((issue) => issue.message) };
  }

  /** Tramos de lo guardado en `usuario.horario`; `null` sin horario y `undefined` si no tiene la forma de un horario. */
  tramosDe(guardado: unknown): TramoHorario[] | null | undefined {
    if (guardado === null || guardado === undefined) return null;
    const resultado = horarioUsuarioSchema.safeParse(guardado);
    return resultado.success ? resultado.data : undefined;
  }
}
