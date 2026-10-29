// Ayudantes de las pruebas del mapa de mesas (historia 004, grupo C1; no protegidas): la API real, dos empresas
// dadas de alta por la vía de plataforma, un usuario de cada rol y llamadas HTTP con la sesión del Administrador.
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import {
  altaEmpresa,
  crearEntorno,
  crearPersona,
  crearSuperadminDePrueba,
  elegirSucursal,
  ingresarSuperadmin,
  llamar,
  loginContrasena,
  tokenAdmin,
  type Empresa,
  type Entorno,
  type Libre,
  type Persona,
} from '../acceso/fabrica-equipos';

export interface EntornoMapa {
  entorno: Entorno;
  app: INestApplication;
  A: Empresa;
  B: Empresa;
  /** Sesión del Administrador de A, sin sucursal activa. */
  admin: string;
  adminB: string;
  /** Una persona de A por rol, todas en S1. */
  mozo: Persona;
  cajero: Persona;
  cocina: Persona;
  supervisor: Persona;
}

/** Arranca la API y deja las empresas A (con tres sucursales) y B (con dos) con sus personas. */
export async function arrancarMapa(): Promise<EntornoMapa> {
  const entorno = await crearEntorno({ logger: false });
  const app = entorno.app;
  const sa = await crearSuperadminDePrueba();
  const tokenSa = await ingresarSuperadmin(app, sa);
  const A = await altaEmpresa(app, tokenSa, { sucursales: 3 });
  const B = await altaEmpresa(app, tokenSa, { sucursales: 2 });
  const en = (rol: 'MOZO' | 'CAJERO' | 'COCINA_BARRA' | 'SUPERVISOR') =>
    crearPersona(app, A, { accesos: [{ sucursalId: A.sucursales[0]!.id, rol }] });
  return {
    entorno,
    app,
    A,
    B,
    admin: await tokenAdmin(app, A),
    adminB: await tokenAdmin(app, B),
    mozo: await en('MOZO'),
    cajero: await en('CAJERO'),
    cocina: await en('COCINA_BARRA'),
    supervisor: await en('SUPERVISOR'),
  };
}

export const unico = (prefijo: string): string => `${prefijo} ${randomUUID().slice(0, 8)}`;

/** Sesión de contraseña de la persona (con su única sucursal activa). */
export async function sesionDe(app: INestApplication, persona: Persona): Promise<string> {
  return (await loginContrasena(app, persona)).token;
}

/** Sesión del Administrador de la empresa con esa sucursal activa. */
export async function adminConSucursal(
  app: INestApplication,
  empresa: Empresa,
  sucursalId: string,
): Promise<string> {
  const token = await tokenAdmin(app, empresa);
  const res = await elegirSucursal(app, token, sucursalId);
  if (res.status !== 200)
    throw new Error(`No se pudo elegir la sucursal: ${res.status} ${res.text}`);
  return token;
}

export async function crearZona(
  app: INestApplication,
  token: string,
  sucursalId: string,
  cuerpo: Libre = {},
): Promise<request.Response> {
  return llamar(app, 'post', `/sucursales/${sucursalId}/zonas`, {
    token,
    cuerpo: { nombre: unico('Zona'), columnas: 4, filas: 3, ...cuerpo },
  });
}

export async function crearMesa(
  app: INestApplication,
  token: string,
  sucursalId: string,
  zonaId: string,
  cuerpo: Libre = {},
): Promise<request.Response> {
  return llamar(app, 'post', `/sucursales/${sucursalId}/zonas/${zonaId}/mesas`, {
    token,
    cuerpo: { nombre: unico('M'), capacidad: 4, forma: 'CUADRADA', columna: 1, fila: 1, ...cuerpo },
  });
}

/** Crea una zona y exige 201. */
export async function zonaCreada(
  app: INestApplication,
  token: string,
  sucursalId: string,
  cuerpo: Libre = {},
): Promise<Libre> {
  const res = await crearZona(app, token, sucursalId, cuerpo);
  if (res.status !== 201) throw new Error(`Crear zona: ${res.status} ${res.text}`);
  return res.body as Libre;
}

/** Crea una mesa y exige 201. */
export async function mesaCreada(
  app: INestApplication,
  token: string,
  sucursalId: string,
  zonaId: string,
  cuerpo: Libre = {},
): Promise<Libre> {
  const res = await crearMesa(app, token, sucursalId, zonaId, cuerpo);
  if (res.status !== 201) throw new Error(`Crear mesa: ${res.status} ${res.text}`);
  return res.body as Libre;
}
