import { Inject, Injectable } from '@nestjs/common';
import {
  emisorEntradaSchema,
  registrarEmpresaEntradaSchema,
  sucursalEntradaSchema,
  uuidSchema,
  type EmisorEntrada,
  type RegistrarEmpresaEntrada,
  type SucursalEntrada,
} from '@restaurante/contratos';
import { SQLSTATE, restriccionDe, sqlstateDe } from '../../nucleo/base-de-datos';
import { ErrorAplicacion, errorDatosInvalidos } from '../../nucleo/errores/error-aplicacion';
import { validarAuditoria } from './auditoria';
import { MODELOS_PLATAFORMA, type Modelos } from './modelos';
import { OperacionPlataforma } from './operacion-plataforma';
import type {
  AuditoriaPlataformaEntrada,
  EmpresaResumen,
  ResultadoRegistroEmpresa,
  TransaccionPlataforma,
} from './tipos';

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
 * Alta y consulta de empresas por la vía de plataforma (sin contexto de empresa). Cada operación
 * valida la auditoría y los datos antes de abrir la transacción, y deja su fila en
 * `auditoria` (origen plataforma). No crea la suscripción (llega con RF-03).
 */
@Injectable()
export class PlataformaEmpresasService {
  constructor(
    @Inject(OperacionPlataforma) private readonly operacion: OperacionPlataforma,
    @Inject(MODELOS_PLATAFORMA) private readonly modelos: Modelos,
  ) {}

  /** Crea empresa, emisores y sucursales en una transacción y la fila de auditoría `registrar_empresa`. */
  async registrarEmpresa(
    datos: RegistrarEmpresaEntrada,
    auditoria: AuditoriaPlataformaEntrada,
  ): Promise<ResultadoRegistroEmpresa> {
    const { actor, motivo } = validarAuditoria(auditoria);
    const resultado = registrarEmpresaEntradaSchema.safeParse(datos);
    if (!resultado.success) throw errorDatosInvalidos(resultado.error);
    const entrada = resultado.data;
    const { Empresa, Emisor, Sucursal } = this.modelos;

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
        }[] = [];
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
          sucursales.push({
            id: creada.id,
            nombre: sucursal.nombre,
            rucEmisor: sucursal.rucEmisor,
            codigoEstablecimiento: sucursal.codigoEstablecimiento,
          });
        }

        this.operacion.registrarDatosDeAuditoria(transaccion, {
          empresaId: empresa.id,
          detalle: { empresa: { id: empresa.id, nombre: entrada.nombre }, emisores, sucursales },
        });
        return {
          empresaId: empresa.id,
          emisores: emisores.map(({ id, ruc }) => ({ id, ruc })),
          sucursales: sucursales.map(({ id, nombre }) => ({ id, nombre })),
        };
      },
    );
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
        await this.exigirEmpresa(empresa, transaccion);
        const creado = await traduciendoUnicidad('', () =>
          this.modelos.Emisor.create(
            {
              empresaId: empresa,
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
        return { id: creado.id, ruc: entrada.ruc };
      },
    );
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

    return this.operacion.ejecutar(
      { actor, motivo, operacion: 'agregar_sucursal', empresaId: empresa },
      async (transaccion) => {
        await this.exigirEmpresa(empresa, transaccion);
        const emisor = await this.modelos.Emisor.findOne({
          where: { empresaId: empresa, ruc: entrada.rucEmisor },
          transaction: transaccion,
        });
        if (!emisor) {
          const mensaje = 'El RUC no corresponde a ningún emisor de la empresa';
          throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', mensaje, [
            { campo: 'rucEmisor', mensaje },
          ]);
        }
        const creada = await traduciendoUnicidad('', () =>
          this.modelos.Sucursal.create(
            {
              empresaId: empresa,
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
        this.operacion.registrarDatosDeAuditoria(transaccion, {
          detalle: {
            sucursal: {
              id: creada.id,
              nombre: entrada.nombre,
              rucEmisor: entrada.rucEmisor,
              codigoEstablecimiento: entrada.codigoEstablecimiento,
            },
          },
        });
        return { id: creada.id, nombre: entrada.nombre };
      },
    );
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
