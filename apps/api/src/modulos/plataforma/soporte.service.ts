import { Inject, Injectable } from '@nestjs/common';
import type { IngresoRespuesta, SoporteEntrada } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import {
  Credenciales,
  MINUTOS_INACTIVIDAD_SOPORTE,
  armarTokenSesion,
  insertarSesionSoporte,
} from '../seguridad';
import { OperacionPlataforma } from './operacion-plataforma';
import { SuscripcionService } from './suscripcion.service';
import type { SuperadministradorAutenticado } from './tipos';

const sequelizeDe = (transaccion: Transaction) =>
  (transaccion as Transaction & { sequelize: Sequelize }).sequelize;

const MINUTO_MS = 60_000;

/**
 * Soporte del superadministrador dentro de una empresa (criterio 66, RF-07): abre una sesión `SOPORTE`
 * con permisos de Administrador en todas las sucursales de la empresa, sin horario, con 30 minutos de
 * inactividad y 2 horas como máximo. En la misma transacción queda la fila `inicio_soporte` (origen
 * plataforma, con la empresa, para que su Administrador la vea). Todo lo que se haga después con esa
 * sesión se audita y se traza con el id del superadministrador y el `sesion_id`.
 */
@Injectable()
export class SoporteService {
  constructor(
    @Inject(OperacionPlataforma) private readonly operacion: OperacionPlataforma,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(Credenciales) private readonly credenciales: Credenciales,
    @Inject(SuscripcionService) private readonly suscripciones: SuscripcionService,
  ) {}

  async iniciar(
    empresaId: string,
    entrada: SoporteEntrada,
    superadministrador: SuperadministradorAutenticado,
  ): Promise<IngresoRespuesta> {
    const ahora = this.reloj.ahora();
    const sesionId = randomUUID();
    const secreto = this.credenciales.generarSecreto();
    const sucursalId = entrada.sucursalId?.toLowerCase() ?? null;

    return this.operacion.ejecutar(
      {
        actor: { superadministradorId: superadministrador.id },
        motivo: entrada.motivo,
        operacion: 'inicio_soporte',
        empresaId,
        sesionId,
      },
      async (transaccion) => {
        const sequelize = sequelizeDe(transaccion);
        const empresas = await sequelize.query<{ id: string }>(
          'SELECT id FROM empresa WHERE id = $1',
          { transaction: transaccion, bind: [empresaId], type: QueryTypes.SELECT },
        );
        if (empresas.length === 0) {
          throw new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La empresa no existe');
        }
        const sucursales = await sequelize.query<{ id: string; nombre: string }>(
          'SELECT id, nombre FROM sucursal WHERE empresa_id = $1 ORDER BY nombre, id',
          { transaction: transaccion, bind: [empresaId], type: QueryTypes.SELECT },
        );
        const activa = sucursalId === null ? null : sucursales.find((s) => s.id === sucursalId);
        if (sucursalId !== null && activa === undefined) {
          // De otra empresa o inexistente: la misma respuesta.
          throw new ErrorAplicacion(
            422,
            'SUCURSAL_INVALIDA',
            'La sucursal no existe en la empresa',
          );
        }

        await insertarSesionSoporte(transaccion, {
          id: sesionId,
          empresaId,
          superadministradorId: superadministrador.id,
          sucursalId,
          huellaSecreto: this.credenciales.huellaSecreto(secreto),
          ahora,
        });
        this.operacion.registrarDatosDeAuditoria(transaccion, {
          sucursalId: sucursalId ?? undefined,
          entidad: 'sesion',
          entidadId: sesionId,
          // El nombre queda aquí porque la API no puede leer la tabla de superadministradores: `GET /sesion`
          // lo toma de esta fila (inmutable y visible para la empresa).
          detalle: {
            superadministrador: { id: superadministrador.id, nombre: superadministrador.nombre },
            sucursalId,
          },
        });

        return {
          token: armarTokenSesion(empresaId, sesionId, secreto),
          sesion: {
            tipo: 'SOPORTE' as const,
            empresaId,
            usuario: null,
            superadministrador: { id: superadministrador.id, nombre: superadministrador.nombre },
            rol: 'ADMINISTRADOR' as const,
            esAdministrador: true,
            sucursal: activa ? { id: activa.id, nombre: activa.nombre } : null,
            sucursales: sucursales.map((s) => ({
              id: s.id,
              nombre: s.nombre,
              rol: 'ADMINISTRADOR' as const,
            })),
            equipo: null,
            permisos: null,
            modulos:
              activa === null || activa === undefined
                ? []
                : await this.suscripciones.modulosPlataforma(transaccion, activa.id),
            avisoSuscripcion: await this.suscripciones.avisoPlataforma(
              transaccion,
              empresaId,
              ahora,
            ),
            debeCambiarContrasena: false,
            expiraPorInactividadEn: new Date(
              ahora.getTime() + MINUTOS_INACTIVIDAD_SOPORTE * MINUTO_MS,
            ).toISOString(),
          },
        };
      },
    );
  }
}
