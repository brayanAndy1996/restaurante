import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../src/aplicacion';
import {
  PERMISO,
  PUBLICA,
  REQUIERE_SUCURSAL,
  SOLO_ADMINISTRADOR,
  Permiso,
  RequiereModulo,
} from '../src/modulos/seguridad';
import { SUPERADMINISTRADOR } from '../src/modulos/plataforma';
import { fijarEntornoDePrueba, rutasDeNest, rutasRegistradas } from './utilidades';
import { Controller, Get } from '@nestjs/common';

// Fase A de la historia 002 (prueba del desarrollador, no protegida): las rutas y los decoradores de
// metadatos están declarados. Desde T10 el guard global de autenticación está registrado: estas pruebas
// usan el modo de prueba (NODE_ENV=test con la cabecera), que da un principal de prueba; las rutas cuya
// lógica llega en tareas posteriores (T12 en adelante) siguen respondiendo 500 sin detalles.

const RUTAS_ESPERADAS = [
  'GET /health',
  'POST /sesiones/contrasena',
  'POST /sesiones/pin',
  'GET /sesion',
  'PUT /sesion/sucursal',
  'PUT /sesion/contrasena',
  'DELETE /sesion',
  'POST /sesion/equipo',
  'GET /sesion/equipos',
  'DELETE /sesion/equipos/:equipoRecordadoId',
  'GET /equipo',
  'GET /usuarios',
  'GET /usuarios/:id',
  'POST /usuarios',
  'PATCH /usuarios/:id',
  'POST /usuarios/:id/pin',
  'POST /usuarios/:id/contrasena',
  'GET /usuarios/:id/equipos',
  'DELETE /usuarios/:id/equipos/:equipoRecordadoId',
  'DELETE /usuarios/:id/equipos',
  'POST /autorizaciones',
  'GET /emisores',
  'POST /emisores',
  'GET /sucursales',
  'GET /sucursales/:id',
  'POST /sucursales',
  'PATCH /sucursales/:id',
  'GET /sucursales/:id/acceso',
  'PATCH /sucursales/:id/acceso',
  'POST /plataforma/sesiones',
  'DELETE /plataforma/sesion',
  'GET /plataforma/empresas',
  'GET /plataforma/empresas/:id',
  'POST /plataforma/empresas',
  'POST /plataforma/empresas/:id/emisores',
  'POST /plataforma/empresas/:id/sucursales',
  'POST /plataforma/empresas/:id/soporte',
  'GET /plataforma/planes',
  'POST /plataforma/planes',
  'PATCH /plataforma/planes/:id',
  'GET /plataforma/suscripciones',
  'PATCH /plataforma/suscripciones/:id',
  'POST /plataforma/suscripciones/:id/pagos',
];

const RUTAS_PUBLICAS = [
  'GET /health',
  'POST /sesiones/contrasena',
  'POST /sesiones/pin',
  'GET /equipo',
  'POST /plataforma/sesiones',
];

@Controller('sonda-fase-a')
class SondaController {
  @Get()
  @Permiso('ANULAR_ORDEN')
  @RequiereModulo('CAJA')
  ver() {
    return { ok: true };
  }
}

describe('rutas de la sección de acceso (fase A)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    fijarEntornoDePrueba();
    app = await crearAplicacion({ controladoresExtra: [SondaController] });
  });
  afterAll(async () => {
    await app.close();
  });

  it('registra todas las rutas de la tabla de endpoints (y la sonda)', () => {
    const registradas = rutasRegistradas(app).map((r) => `${r.metodo} ${r.ruta}`);
    for (const esperada of RUTAS_ESPERADAS) expect(registradas, esperada).toContain(esperada);
    expect(registradas).toContain('GET /sonda-fase-a');
    expect(new Set(registradas).size).toBe(registradas.length);
  });

  it('rutasDeNest coincide con lo que Express tiene registrado', () => {
    const deNest = rutasDeNest(app).map((r) => `${r.metodo} ${r.ruta}`);
    const registradas = rutasRegistradas(app).map((r) => `${r.metodo} ${r.ruta}`);
    expect([...deNest].sort()).toEqual([...registradas].sort());
  });

  it('las rutas públicas son exactamente las de la lista cerrada (criterio 1)', () => {
    const publicas = rutasDeNest(app)
      .filter((r) => Reflect.getMetadata(PUBLICA, r.controlador.prototype[r.manejador]) === true)
      .map((r) => `${r.metodo} ${r.ruta}`);
    expect([...publicas].sort()).toEqual([...RUTAS_PUBLICAS].sort());
  });

  it('toda ruta /plataforma/* salvo POST /plataforma/sesiones lleva @Superadministrador()', () => {
    for (const r of rutasDeNest(app).filter((x) => x.ruta.startsWith('/plataforma'))) {
      const marcada =
        Reflect.getMetadata(SUPERADMINISTRADOR, r.controlador) === true ||
        Reflect.getMetadata(SUPERADMINISTRADOR, r.controlador.prototype[r.manejador]) === true;
      const esperada = !(r.metodo === 'POST' && r.ruta === '/plataforma/sesiones');
      expect(marcada, `${r.metodo} ${r.ruta}`).toBe(esperada);
    }
  });

  it('@Permiso, @SoloAdministrador y @RequiereSucursal dejan sus metadatos', () => {
    const sonda = rutasDeNest(app).find((r) => r.controlador === SondaController);
    expect(Reflect.getMetadata(PERMISO, SondaController.prototype.ver)).toBe('ANULAR_ORDEN');
    expect(sonda).toBeDefined();
    const autorizar = rutasDeNest(app).find((r) => r.ruta === '/autorizaciones');
    expect(
      Reflect.getMetadata(
        REQUIERE_SUCURSAL,
        autorizar!.controlador.prototype[autorizar!.manejador],
      ),
    ).toBe(true);
    const usuarios = rutasDeNest(app).filter((r) => r.ruta.startsWith('/usuarios'));
    expect(usuarios.length).toBeGreaterThan(0);
    for (const r of usuarios) {
      expect(Reflect.getMetadata(SOLO_ADMINISTRADOR, r.controlador), `${r.metodo} ${r.ruta}`).toBe(
        true,
      );
    }
  });

  it('GET /health sigue respondiendo sin empresa', async () => {
    expect((await request(app.getHttpServer()).get('/health')).status).toBe(200);
  });

  it('las rutas cuya lógica llega en tareas posteriores responden "No implementado" como 500 sin detalles', async () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const servidor = () => request(app.getHttpServer());
    const casos = [
      () => servidor().get('/sesion').set('x-empresa-id', id),
      () => servidor().get('/equipo'),
      () => servidor().get('/plataforma/empresas'),
      () => servidor().delete('/plataforma/sesion'),
    ];
    for (const caso of casos) {
      const res = await caso();
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ codigo: 'ERROR_INTERNO' });
      expect(JSON.stringify(res.body)).not.toContain('No implementado');
    }
  });
});
