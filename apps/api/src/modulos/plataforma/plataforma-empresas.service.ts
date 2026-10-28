import { Inject, Injectable } from '@nestjs/common';
import {
  administradorInicialEntradaSchema,
  emisorEntradaSchema,
  minusculasAscii,
  registrarEmpresaEntradaSchema,
  sucursalEntradaSchema,
  uuidSchema,
  type AdministradorInicialEntrada,
  type EmisorEntrada,
  type EmisorRespuesta,
  type EmpresaPlataformaDetalle,
  type EmpresaPlataformaResumen,
  type RegistrarEmpresaEntrada,
  type SucursalEntrada,
  type SuscripcionAltaEntrada,
  type SuscripcionRespuesta,
} from '@restaurante/contratos';
import { fechaLima } from '@restaurante/dominio';
import { z } from 'zod';
import { SQLSTATE, restriccionDe, sqlstateDe } from '../../nucleo/base-de-datos';
import { ErrorAplicacion, errorDatosInvalidos } from '../../nucleo/errores/error-aplicacion';
import { RELOJ, type Reloj } from '../../nucleo/reloj';
import {
  Credenciales,
  CupoScrypt,
  GRUPO_PLATAFORMA,
  administradoresDeEmpresa,
  insertarAdministradorInicial,
} from '../seguridad';
import { validarAuditoria } from './auditoria';
import { emisorARespuesta } from './emisores.service';
import {
  MODELOS_PLATAFORMA,
  type EmisorModelo,
  type Modelos,
  type SucursalModelo,
} from './modelos';
import { OperacionPlataforma } from './operacion-plataforma';
import { PlanesService, type PlanElegido } from './planes.service';
import { sucursalARespuesta } from './sucursal.service';
import { SuscripcionService } from './suscripcion.service';
import type {
  AuditoriaPlataformaEntrada,
  EmpresaResumen,
  IdempotenciaPlataforma,
  ResultadoRegistroEmpresa,
  TransaccionPlataforma,
} from './tipos';

/** Datos del alta de una empresa: los de 001 y, opcionalmente, su primer Administrador (criterio 63). */
export type RegistrarEmpresaDatos = RegistrarEmpresaEntrada & {
  administrador?: AdministradorInicialEntrada;
};

/** Sucursal creada por plataforma, con su suscripción (criterio 69). */
export interface SucursalCreada {
  id: string;
  nombre: string;
  suscripcion: SuscripcionRespuesta;
}

/** Resultado del alta por HTTP: como `ResultadoRegistroEmpresa`, con la suscripción de cada sucursal. */
export interface ResultadoAltaEmpresa extends Omit<ResultadoRegistroEmpresa, 'sucursales'> {
  sucursales: SucursalCreada[];
}

const entradaDeAdministradorSchema = z.object({ administrador: administradorInicialEntradaSchema });

/** Restricciones de unicidad que el alta traduce a un error de validación con su campo. */
const CAMPO_POR_RESTRICCION: Record<string, { campo: string; mensaje: string }> = {
  emisor_ruc_unico: { campo: 'ruc', mensaje: 'El RUC ya está registrado' },
  sucursal_emisor_codigo_unico: {
    campo: 'codigoEstablecimiento',
    mensaje: 'Ya existe una sucursal de ese emisor con el mismo código de establecimiento',
  },
  sucursal_empresa_nombre_unico: {
    campo: 'nombre',
    mensaje: 'Ya existe una sucursal de la empresa con ese nombre',
  },
};

/**
 * Ejecuta `escribir`; si PostgreSQL rechaza por unicidad, lanza 400 DATOS_INVALIDOS indicando el
 * campo (`prefijo` es la ruta del elemento, por ejemplo `sucursales.2`).
 */
async function traduciendoUnicidad<T>(prefijo: string, escribir: () => Promise<T>): Promise<T> {
  try {
    return await escribir();
  } catch (error) {
    const conocida = CAMPO_POR_RESTRICCION[restriccionDe(error) ?? ''];
    if (sqlstateDe(error) === SQLSTATE.VIOLACION_UNICIDAD && conocida) {
      const campo = prefijo === '' ? conocida.campo : `${prefijo}.${conocida.campo}`;
      throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', conocida.mensaje, [
        { campo, mensaje: conocida.mensaje },
      ]);
    }
    throw error;
  }
}

function empresaNoEncontrada(): ErrorAplicacion {
  return new ErrorAplicacion(404, 'NO_ENCONTRADO', 'La empresa no existe');
}

/**
 * Un vencimiento indicado no puede ser anterior a hoy (fecha de Lima, criterio 63): 400 con el campo.
 * `prefijo` es la ruta de la sucursal (`sucursales.2`) o vacío.
 */
function validarVencimiento(
  suscripcion: SuscripcionAltaEntrada | undefined,
  prefijo: string,
  ahora: Date,
): void {
  const vencimiento = suscripcion?.vencimiento;
  if (vencimiento === undefined || vencimiento >= fechaLima(ahora)) return;
  const campo = `${prefijo === '' ? '' : `${prefijo}.`}suscripcion.vencimiento`;
  throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'El vencimiento no puede ser anterior a hoy', [
    { campo, mensaje: 'No puede ser anterior a hoy' },
  ]);
}

/**
 * Alta y consulta de empresas por la vía de plataforma (sin contexto de empresa). Cada operación
 * valida la auditoría y los datos antes de abrir la transacción, y deja su fila en
 * `auditoria` (origen plataforma). El actor de la auditoría es también el de trazabilidad: un texto
 * (semilla, scripts) o `{ superadministradorId }` (rutas HTTP). La suscripción de cada sucursal llega con
 * el grupo C1 (RF-03).
 */
@Injectable()
export class PlataformaEmpresasService {
  constructor(
    @Inject(OperacionPlataforma) private readonly operacion: OperacionPlataforma,
    @Inject(MODELOS_PLATAFORMA) private readonly modelos: Modelos,
    @Inject(Credenciales) private readonly credenciales: Credenciales,
    @Inject(CupoScrypt) private readonly cupo: CupoScrypt,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(PlanesService) private readonly planes: PlanesService,
    @Inject(SuscripcionService) private readonly suscripciones: SuscripcionService,
  ) {}

  /**
   * Crea empresa, emisores y sucursales (y, si se envía `administrador`, al primer Administrador con su
   * PIN de 6 dígitos), la suscripción de cada sucursal y la fila de auditoría `registrar_empresa`, en una
   * transacción. Todo o nada.
   */
  async registrarEmpresa(
    datos: RegistrarEmpresaDatos,
    auditoria: AuditoriaPlataformaEntrada,
  ): Promise<ResultadoRegistroEmpresa> {
    const completo = await this.registrarEmpresaConSuscripciones(datos, auditoria);
    return {
      ...completo,
      sucursales: completo.sucursales.map(({ id, nombre }) => ({ id, nombre })),
    };
  }

  /** `POST /plataforma/empresas` (criterio 63): como `registrarEmpresa`, con la suscripción de cada sucursal. */
  async registrarEmpresaConSuscripciones(
    datos: RegistrarEmpresaDatos,
    auditoria: AuditoriaPlataformaEntrada,
  ): Promise<ResultadoAltaEmpresa> {
    const { actor, motivo } = validarAuditoria(auditoria);
    const resultado = registrarEmpresaEntradaSchema.safeParse(datos);
    if (!resultado.success) throw errorDatosInvalidos(resultado.error);
    const entrada = resultado.data;
    let administrador: AdministradorInicialEntrada | undefined;
    if (datos.administrador !== undefined) {
      const validado = entradaDeAdministradorSchema.safeParse({
        administrador: datos.administrador,
      });
      if (!validado.success) throw errorDatosInvalidos(validado.error);
      administrador = validado.data.administrador;
    }
    const ahora = this.reloj.ahora();
    for (const [i, sucursal] of entrada.sucursales.entries()) {
      validarVencimiento(sucursal.suscripcion, `sucursales.${i}`, ahora);
    }
    const { Empresa, Emisor, Sucursal } = this.modelos;
    // Scrypt de la contraseña temporal antes de abrir la transacción de plataforma, por el cupo del grupo
    // `plataforma` (el alta la hace un superadministrador): ninguna conexión espera mientras corre.
    const hashContrasena =
      administrador === undefined
        ? undefined
        : await this.cupo.conCupo(GRUPO_PLATAFORMA, () =>
            this.credenciales.hashContrasena(administrador.contrasenaTemporal),
          );

    return this.operacion.ejecutar(
      { actor, motivo, operacion: 'registrar_empresa' },
      async (transaccion) => {
        const empresa = await Empresa.create(
          { nombre: entrada.nombre },
          { transaction: transaccion },
        );

        const emisores: { id: string; ruc: string; razonSocial: string; regimen: string }[] = [];
        for (const [i, emisor] of entrada.emisores.entries()) {
          const creado = await traduciendoUnicidad(`emisores.${i}`, () =>
            Emisor.create(
              {
                empresaId: empresa.id,
                ruc: emisor.ruc,
                razonSocial: emisor.razonSocial,
                regimen: emisor.regimen,
              },
              { transaction: transaccion },
            ),
          );
          emisores.push({
            id: creado.id,
            ruc: emisor.ruc,
            razonSocial: emisor.razonSocial,
            regimen: emisor.regimen,
          });
        }

        const sucursales: {
          id: string;
          nombre: string;
          rucEmisor: string;
          codigoEstablecimiento: string;
          suscripcion: SuscripcionRespuesta;
        }[] = [];
        const planes = new Map<string, PlanElegido>();
        for (const [i, sucursal] of entrada.sucursales.entries()) {
          const emisor = emisores.find((e) => e.ruc === sucursal.rucEmisor);
          if (!emisor) {
            // Ya lo valida el esquema; defensa por si cambia.
            throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', 'El RUC no corresponde a un emisor', [
              { campo: `sucursales.${i}.rucEmisor`, mensaje: 'El RUC no corresponde a un emisor' },
            ]);
          }
          const creada = await traduciendoUnicidad(`sucursales.${i}`, () =>
            Sucursal.create(
              {
                empresaId: empresa.id,
                emisorId: emisor.id,
                nombre: sucursal.nombre,
                codigoEstablecimiento: sucursal.codigoEstablecimiento,
                direccion: sucursal.direccion,
                horario: sucursal.horario,
                whatsapp: sucursal.whatsapp ?? null,
                horaCorte: sucursal.horaCorte,
              },
              { transaction: transaccion },
            ),
          );
          // Cada sucursal nace con exactamente una suscripción (criterio 69): un plan inexistente o inactivo
          // responde 422 y la operación entera se revierte.
          const suscripcion = await this.suscripciones.crear(transaccion, {
            empresaId: empresa.id,
            sucursalId: creada.id,
            plan: await this.planDeSuscripcion(transaccion, planes, sucursal.suscripcion?.planId),
            vencimiento:
              sucursal.suscripcion?.vencimiento ?? this.suscripciones.vencimientoPorDefecto(ahora),
            ahora,
          });
          sucursales.push({
            id: creada.id,
            nombre: sucursal.nombre,
            rucEmisor: sucursal.rucEmisor,
            codigoEstablecimiento: sucursal.codigoEstablecimiento,
            suscripcion,
          });
        }

        let primerAdministrador: { id: string; pin: string } | undefined;
        if (administrador !== undefined && hashContrasena !== undefined) {
          primerAdministrador = await insertarAdministradorInicial(transaccion, this.credenciales, {
            empresaId: empresa.id,
            nombre: administrador.nombre,
            nombreUsuario: minusculasAscii(administrador.nombreUsuario),
            hashContrasena,
            ahora,
          });
        }

        this.operacion.registrarDatosDeAuditoria(transaccion, {
          empresaId: empresa.id,
          detalle: {
            empresa: { id: empresa.id, nombre: entrada.nombre },
            emisores,
            sucursales: sucursales.map(({ suscripcion, ...sucursal }) => ({
              ...sucursal,
              suscripcion: {
                id: suscripcion.id,
                planId: suscripcion.plan.id,
                vencimiento: suscripcion.vencimiento,
              },
            })),
            // Sin la contraseña temporal ni el PIN: solo quién es el primer Administrador.
            ...(administrador === undefined || primerAdministrador === undefined
              ? {}
              : {
                  administrador: {
                    id: primerAdministrador.id,
                    nombre: administrador.nombre,
                    nombreUsuario: minusculasAscii(administrador.nombreUsuario),
                  },
                }),
          },
        });
        return {
          empresaId: empresa.id,
          emisores: emisores.map(({ id, ruc }) => ({ id, ruc })),
          sucursales: sucursales.map(({ id, nombre, suscripcion }) => ({
            id,
            nombre,
            suscripcion,
          })),
          ...(primerAdministrador === undefined ? {} : { administrador: primerAdministrador }),
        };
      },
    );
  }

  /** El plan de una suscripción nueva (el indicado o el por defecto), consultado una sola vez por operación. */
  private async planDeSuscripcion(
    transaccion: TransaccionPlataforma,
    memoria: Map<string, PlanElegido>,
    planId: string | undefined,
  ): Promise<PlanElegido> {
    const clave = planId?.toLowerCase() ?? '';
    const conocido = memoria.get(clave);
    if (conocido !== undefined) return conocido;
    const plan = await this.planes.elegirParaSuscripcion(transaccion, planId);
    memoria.set(clave, plan);
    return plan;
  }

  /** Agrega un emisor a una empresa existente (auditoría `agregar_emisor`). */
  async agregarEmisor(
    empresaId: string,
    datos: EmisorEntrada,
    auditoria: AuditoriaPlataformaEntrada,
  ): Promise<{ id: string; ruc: string }> {
    const { actor, motivo } = validarAuditoria(auditoria);
    const empresa = this.validarEmpresaId(empresaId);
    const resultado = emisorEntradaSchema.safeParse(datos);
    if (!resultado.success) throw errorDatosInvalidos(resultado.error);
    const entrada = resultado.data;

    return this.operacion.ejecutar(
      { actor, motivo, operacion: 'agregar_emisor', empresaId: empresa },
      async (transaccion) => {
        const creado = await this.crearEmisor(transaccion, empresa, entrada);
        return { id: creado.id, ruc: entrada.ruc };
      },
    );
  }

  /**
   * `POST /plataforma/empresas/:id/emisores` (criterio 64): como `agregarEmisor`, con la respuesta
   * completa y la clave de idempotencia opcional (criterio 85).
   */
  async agregarEmisorPorHttp(
    empresaId: string,
    datos: EmisorEntrada,
    auditoria: AuditoriaPlataformaEntrada,
    idempotencia?: IdempotenciaPlataforma,
  ): Promise<EmisorRespuesta> {
    const { actor, motivo } = validarAuditoria(auditoria);
    const empresa = this.validarEmpresaId(empresaId);
    const resultado = emisorEntradaSchema.safeParse(datos);
    if (!resultado.success) throw errorDatosInvalidos(resultado.error);
    const entrada = resultado.data;

    return this.operacion.ejecutar(
      {
        actor,
        motivo,
        operacion: 'agregar_emisor',
        empresaId: empresa,
        ...(idempotencia === undefined ? {} : { idempotencia }),
      },
      async (transaccion) =>
        emisorARespuesta(await this.crearEmisor(transaccion, empresa, entrada)),
    );
  }

  private async crearEmisor(
    transaccion: TransaccionPlataforma,
    empresaId: string,
    entrada: { ruc: string; razonSocial: string; regimen: EmisorModelo['regimen'] },
  ): Promise<EmisorModelo> {
    await this.exigirEmpresa(empresaId, transaccion);
    const creado = await traduciendoUnicidad('', () =>
      this.modelos.Emisor.create(
        {
          empresaId,
          ruc: entrada.ruc,
          razonSocial: entrada.razonSocial,
          regimen: entrada.regimen,
        },
        { transaction: transaccion },
      ),
    );
    this.operacion.registrarDatosDeAuditoria(transaccion, {
      detalle: { emisor: { id: creado.id, ruc: entrada.ruc, regimen: entrada.regimen } },
    });
    return creado;
  }

  /** Agrega una sucursal a una empresa existente (auditoría `agregar_sucursal`). */
  async agregarSucursal(
    empresaId: string,
    datos: SucursalEntrada,
    auditoria: AuditoriaPlataformaEntrada,
  ): Promise<{ id: string; nombre: string }> {
    const { actor, motivo } = validarAuditoria(auditoria);
    const empresa = this.validarEmpresaId(empresaId);
    const resultado = sucursalEntradaSchema.safeParse(datos);
    if (!resultado.success) throw errorDatosInvalidos(resultado.error);
    const entrada = resultado.data;
    const ahora = this.reloj.ahora();

    return this.operacion.ejecutar(
      { actor, motivo, operacion: 'agregar_sucursal', empresaId: empresa },
      async (transaccion) => {
        const { creada } = await this.crearSucursal(transaccion, empresa, entrada, ahora);
        return { id: creada.id, nombre: entrada.nombre };
      },
    );
  }

  /**
   * `POST /plataforma/empresas/:id/sucursales` (criterio 64): como `agregarSucursal`, con su suscripción
   * en la respuesta y la clave de idempotencia opcional.
   */
  async agregarSucursalPorHttp(
    empresaId: string,
    datos: SucursalEntrada,
    auditoria: AuditoriaPlataformaEntrada,
    idempotencia?: IdempotenciaPlataforma,
  ): Promise<SucursalCreada> {
    const { actor, motivo } = validarAuditoria(auditoria);
    const empresa = this.validarEmpresaId(empresaId);
    const resultado = sucursalEntradaSchema.safeParse(datos);
    if (!resultado.success) throw errorDatosInvalidos(resultado.error);
    const entrada = resultado.data;
    const ahora = this.reloj.ahora();

    return this.operacion.ejecutar(
      {
        actor,
        motivo,
        operacion: 'agregar_sucursal',
        empresaId: empresa,
        ...(idempotencia === undefined ? {} : { idempotencia }),
      },
      async (transaccion) => {
        const { creada, suscripcion } = await this.crearSucursal(
          transaccion,
          empresa,
          entrada,
          ahora,
        );
        return { id: creada.id, nombre: entrada.nombre, suscripcion };
      },
    );
  }

  /** Crea la sucursal con su suscripción (plan indicado o por defecto; 422 `PLAN_INVALIDO`). */
  private async crearSucursal(
    transaccion: TransaccionPlataforma,
    empresaId: string,
    entrada: z.output<typeof sucursalEntradaSchema>,
    ahora: Date,
  ): Promise<{ creada: SucursalModelo; suscripcion: SuscripcionRespuesta }> {
    await this.exigirEmpresa(empresaId, transaccion);
    // Dentro de la operación: una repetición con la misma `Idempotency-Key` devuelve la respuesta guardada
    // antes de llegar aquí, aunque el vencimiento ya haya quedado en el pasado.
    validarVencimiento(entrada.suscripcion, '', ahora);
    const emisor = await this.modelos.Emisor.findOne({
      where: { empresaId, ruc: entrada.rucEmisor },
      transaction: transaccion,
    });
    if (!emisor) {
      throw new ErrorAplicacion(
        422,
        'EMISOR_INVALIDO',
        'El RUC no corresponde a ningún emisor de la empresa',
      );
    }
    const creada = await traduciendoUnicidad('', () =>
      this.modelos.Sucursal.create(
        {
          empresaId,
          emisorId: emisor.id,
          nombre: entrada.nombre,
          codigoEstablecimiento: entrada.codigoEstablecimiento,
          direccion: entrada.direccion,
          horario: entrada.horario,
          whatsapp: entrada.whatsapp ?? null,
          horaCorte: entrada.horaCorte,
        },
        { transaction: transaccion },
      ),
    );
    const plan = await this.planes.elegirParaSuscripcion(transaccion, entrada.suscripcion?.planId);
    const suscripcion = await this.suscripciones.crear(transaccion, {
      empresaId,
      sucursalId: creada.id,
      plan,
      vencimiento:
        entrada.suscripcion?.vencimiento ?? this.suscripciones.vencimientoPorDefecto(ahora),
      ahora,
    });
    this.operacion.registrarDatosDeAuditoria(transaccion, {
      sucursalId: creada.id,
      detalle: {
        sucursal: {
          id: creada.id,
          nombre: entrada.nombre,
          rucEmisor: entrada.rucEmisor,
          codigoEstablecimiento: entrada.codigoEstablecimiento,
        },
        suscripcion: {
          id: suscripcion.id,
          planId: suscripcion.plan.id,
          vencimiento: suscripcion.vencimiento,
        },
      },
    });
    return { creada, suscripcion };
  }

  /** Todas las empresas (lectura de plataforma, sin auditoría). */
  async listarEmpresas(): Promise<EmpresaResumen[]> {
    return this.operacion.consultar(async (transaccion) => {
      const empresas = await this.modelos.Empresa.findAll({
        order: [['nombre', 'ASC']],
        transaction: transaccion,
      });
      return empresas.map((e) => ({ id: e.id, nombre: e.nombre }));
    });
  }

  /**
   * `GET /plataforma/empresas` (criterio 65): las empresas con sus sucursales y el estado de cada
   * suscripción, calculado con el reloj de la API (`null` si la sucursal no tiene suscripción).
   */
  async listarConSucursales(): Promise<EmpresaPlataformaResumen[]> {
    const ahora = this.reloj.ahora();
    return this.operacion.consultar(async (transaccion) => {
      const suscripciones = await this.suscripciones.porSucursal(transaccion, null, ahora);
      const empresas = await this.modelos.Empresa.findAll({
        order: [['nombre', 'ASC']],
        transaction: transaccion,
      });
      const sucursales = await this.modelos.Sucursal.findAll({
        order: [['nombre', 'ASC']],
        transaction: transaccion,
      });
      return empresas.map((empresa) => ({
        id: empresa.id,
        nombre: empresa.nombre,
        creadoEn: empresa.creadoEn.toISOString(),
        sucursales: sucursales
          .filter((s) => s.empresaId === empresa.id)
          .map((s) => ({
            id: s.id,
            nombre: s.nombre,
            estadoSuscripcion: suscripciones.get(s.id)?.estado ?? null,
          })),
      }));
    });
  }

  /** `GET /plataforma/empresas/:id` (criterio 65): emisores, sucursales, suscripciones y administradores. */
  async obtenerDetalle(empresaId: string): Promise<EmpresaPlataformaDetalle> {
    const id = this.validarEmpresaId(empresaId);
    const ahora = this.reloj.ahora();
    return this.operacion.consultar(async (transaccion) => {
      const empresa = await this.modelos.Empresa.findByPk(id, { transaction: transaccion });
      if (!empresa) throw empresaNoEncontrada();
      const suscripciones = await this.suscripciones.porSucursal(transaccion, [id], ahora);
      const emisores = await this.modelos.Emisor.findAll({
        where: { empresaId: id },
        order: [['razonSocial', 'ASC']],
        transaction: transaccion,
      });
      const sucursales = await this.modelos.Sucursal.findAll({
        where: { empresaId: id },
        order: [['nombre', 'ASC']],
        transaction: transaccion,
      });
      return {
        id: empresa.id,
        nombre: empresa.nombre,
        creadoEn: empresa.creadoEn.toISOString(),
        emisores: emisores.map(emisorARespuesta),
        sucursales: sucursales.map(sucursalARespuesta),
        suscripciones: sucursales.flatMap((s) => suscripciones.get(s.id) ?? []),
        administradores: await administradoresDeEmpresa(transaccion, id),
      };
    });
  }

  private validarEmpresaId(empresaId: string): string {
    if (!uuidSchema.safeParse(empresaId).success) {
      throw new ErrorAplicacion(
        400,
        'DATOS_INVALIDOS',
        'El identificador de la empresa no es válido',
        [{ campo: 'empresaId', mensaje: 'Debe ser un UUID' }],
      );
    }
    return empresaId.toLowerCase();
  }

  private async exigirEmpresa(
    empresaId: string,
    transaccion: TransaccionPlataforma,
  ): Promise<void> {
    const empresa = await this.modelos.Empresa.findByPk(empresaId, { transaction: transaccion });
    if (!empresa) throw empresaNoEncontrada();
  }
}
