// spec: 001-base-multitenancy (pruebas protegidas)
//
// P5 · Criterios 11 (servicio), 18, 23, 26, 29, 30, 31, 39 y 40: endpoints de sucursal con el
// resolutor por cabecera (aislamiento, 404 y 422 indistinguibles, PATCH válido e inválido), ruta sin
// empresa resuelta, 100 peticiones concurrentes con pool de 2 y un controlador sonda propio, y el
// comportamiento según NODE_ENV / EMPRESA_POR_HEADER. Cada describe crea su propia app.
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { sucursalRespuestaSchema } from '@restaurante/contratos';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { ContextoEmpresa, SinEmpresa } from '../../src/nucleo/contexto-empresa';
import { SucursalService } from '../../src/modulos/plataforma';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { crearEmpresaSql, fotoDeFila, textoUnico, type EmpresaSql } from './fabrica';

// Controladores sonda propios de las pruebas.

/** Criterio 26: dos consultas separadas por una espera asíncrona; devuelve lo que ve en cada momento. */
@Controller('sonda-concurrencia')
class SondaConcurrenciaController {
  constructor(
    private readonly contexto: ContextoEmpresa,
    private readonly sucursales: SucursalService,
  ) {}

  @Get()
  async ver() {
    const empresaAntes = this.contexto.empresaActual();
    const primera = await this.sucursales.listar();
    await new Promise<void>((resolver) => setTimeout(resolver, 5 + Math.floor(Math.random() * 20)));
    const empresaMedio = this.contexto.empresaActual();
    const segunda = await this.sucursales.listar();
    return {
      empresaAntes,
      empresaMedio,
      empresaDespues: this.contexto.empresaActual(),
      primera: primera.map((s) => s.id).sort(),
      segunda: segunda.map((s) => s.id).sort(),
      empresasVistas: [...new Set([...primera, ...segunda].map((s) => s.empresaId))],
    };
  }
}

/** Ruta de empresa sin marcar: cuenta cuántas veces llegó a ejecutarse el controlador. */
@Controller('sonda-contexto')
class SondaContextoController {
  static llamadas = 0;
  constructor(private readonly contexto: ContextoEmpresa) {}

  @Get()
  ver() {
    SondaContextoController.llamadas += 1;
    return { empresaId: this.contexto.empresaActual() };
  }
}

/** Ruta marcada con @SinEmpresa(): no necesita empresa. */
@Controller('sonda-libre')
class SondaLibreController {
  @Get()
  @SinEmpresa()
  ver() {
    return { libre: true };
  }
}

const SONDAS = [SondaConcurrenciaController, SondaContextoController, SondaLibreController];
const ids = (filas: { id: string }[]) => filas.map((f) => f.id).sort();

let plataforma: Client;
beforeAll(async () => {
  plataforma = await abrirCliente('plataforma');
});
afterAll(async () => {
  await plataforma?.end();
});

describe('resolutor por cabecera (NODE_ENV=test, EMPRESA_POR_HEADER=habilitado)', () => {
  let app: INestApplication;
  let contexto: ContextoEmpresa;
  let sucursales: SucursalService;
  let A: EmpresaSql;
  let B: EmpresaSql;

  beforeAll(async () => {
    fijarEntornoDePrueba({ poolMax: 2 });
    app = await crearAplicacion({ controladoresExtra: SONDAS });
    await app.listen(0);
    contexto = app.get(ContextoEmpresa);
    sucursales = app.get(SucursalService);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(async () => {
    A = await crearEmpresaSql(plataforma, { emisores: 2, sucursales: 3 });
    B = await crearEmpresaSql(plataforma);
    SondaContextoController.llamadas = 0;
  });

  const http = () => request(app.getHttpServer());
  const comoA = () => ({ 'x-empresa-id': A.id });

  describe('criterio 11 · SucursalService.obtener', () => {
    it('devuelve null para la sucursal de B igual que para un id inexistente', async () => {
      const ajena = await contexto.ejecutar(A.id, () => sucursales.obtener(B.sucursales[0]!.id));
      const inexistente = await contexto.ejecutar(A.id, () => sucursales.obtener(randomUUID()));
      expect(ajena).toBeNull();
      expect(inexistente).toBeNull();
      const propia = await contexto.ejecutar(A.id, () => sucursales.obtener(A.sucursales[0]!.id));
      expect(propia).toMatchObject({ id: A.sucursales[0]!.id, empresaId: A.id });
    });
  });

  describe('criterio 18 · aislamiento por HTTP', () => {
    it('GET /sucursales devuelve solo sucursales de A', async () => {
      const res = await http().get('/sucursales').set(comoA());
      expect(res.status).toBe(200);
      const lista = sucursalRespuestaSchema.array().parse(res.body);
      expect(ids(lista)).toEqual(ids(A.sucursales));
      expect(lista.every((s) => s.empresaId === A.id)).toBe(true);
    });

    it('GET /sucursales/{id de B} responde 404 con el mismo cuerpo que un id inexistente', async () => {
      const ajena = await http().get(`/sucursales/${B.sucursales[0]!.id}`).set(comoA());
      const inexistente = await http().get(`/sucursales/${randomUUID()}`).set(comoA());
      expect(ajena.status).toBe(404);
      expect(ajena.body).toMatchObject({ codigo: 'NO_ENCONTRADO' });
      expect(inexistente.status).toBe(404);
      expect(ajena.body).toEqual(inexistente.body);
    });

    it('PATCH /sucursales/{id de B} responde 404 como un id inexistente y la sucursal de B no cambia', async () => {
      const antes = await fotoDeFila(plataforma, 'sucursal', B.sucursales[0]!.id);
      const cambios = { nombre: textoUnico('Hackeada'), direccion: 'Calle Hackeada 1' };
      const ajena = await http()
        .patch(`/sucursales/${B.sucursales[0]!.id}`)
        .set(comoA())
        .send(cambios);
      const inexistente = await http()
        .patch(`/sucursales/${randomUUID()}`)
        .set(comoA())
        .send(cambios);
      expect(ajena.status).toBe(404);
      expect(ajena.body).toMatchObject({ codigo: 'NO_ENCONTRADO' });
      expect(inexistente.status).toBe(404);
      expect(ajena.body).toEqual(inexistente.body);
      expect(await fotoDeFila(plataforma, 'sucursal', B.sucursales[0]!.id)).toEqual(antes);
    });

    // A.sucursales[0] y la sucursal de B tienen el mismo código de establecimiento (0001): aunque la
    // unicidad chocaría con el emisor de B, la respuesta debe seguir siendo la de un emisor inexistente.
    it('PATCH con el emisorId de B responde 422 EMISOR_INVALIDO, igual que con un emisor inexistente, y no cambia nada', async () => {
      const id = A.sucursales[0]!.id;
      const antes = await fotoDeFila(plataforma, 'sucursal', id);
      const cruzado = await http()
        .patch(`/sucursales/${id}`)
        .set(comoA())
        .send({ emisorId: B.emisores[0]!.id });
      const inexistente = await http()
        .patch(`/sucursales/${id}`)
        .set(comoA())
        .send({ emisorId: randomUUID() });
      expect(cruzado.status).toBe(422);
      expect(cruzado.body).toMatchObject({ codigo: 'EMISOR_INVALIDO' });
      expect(inexistente.status).toBe(422);
      expect(cruzado.body).toEqual(inexistente.body);
      expect(await fotoDeFila(plataforma, 'sucursal', id)).toEqual(antes);
    });
  });

  describe('criterio 23 · ruta de empresa sin empresa resuelta', () => {
    it('responde 401 EMPRESA_NO_RESUELTA y el controlador no se ejecuta', async () => {
      const res = await http().get('/sonda-contexto');
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ codigo: 'EMPRESA_NO_RESUELTA' });
      expect(SondaContextoController.llamadas).toBe(0);
    });

    it('lo mismo ocurre con las rutas reales de sucursal', async () => {
      const id = A.sucursales[0]!.id;
      const antes = await fotoDeFila(plataforma, 'sucursal', id);
      for (const res of [
        await http().get('/sucursales'),
        await http().get(`/sucursales/${id}`),
        await http().patch(`/sucursales/${id}`).send({ direccion: 'Sin empresa' }),
      ]) {
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ codigo: 'EMPRESA_NO_RESUELTA' });
      }
      expect(await fotoDeFila(plataforma, 'sucursal', id)).toEqual(antes);
    });

    it('una ruta marcada con @SinEmpresa() responde sin empresa', async () => {
      const res = await http().get('/sonda-libre');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ libre: true });
    });
  });

  describe('criterio 26 · 100 peticiones concurrentes con un pool de 2 conexiones', () => {
    it('cada respuesta contiene solo datos de su empresa y empresaActual() es la de su petición', async () => {
      const total = 100;
      const respuestas = await Promise.all(
        Array.from({ length: total }, (_, i) => {
          const empresa = i % 2 === 0 ? A : B;
          return http()
            .get('/sonda-concurrencia')
            .set('x-empresa-id', empresa.id)
            .then((res) => ({ empresa, res }));
        }),
      );
      expect(respuestas).toHaveLength(total);
      for (const { empresa, res } of respuestas) {
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.empresaAntes).toBe(empresa.id);
        expect(res.body.empresaMedio).toBe(empresa.id);
        expect(res.body.empresaDespues).toBe(empresa.id);
        expect(res.body.empresasVistas).toEqual([empresa.id]);
        expect(res.body.primera).toEqual(ids(empresa.sucursales));
        expect(res.body.segunda).toEqual(ids(empresa.sucursales));
      }
    });
  });

  describe('criterio 31 · cabecera x-empresa-id con NODE_ENV=test', () => {
    it('con un UUID válido la petición corre con ese contexto', async () => {
      const res = await http().get('/sonda-contexto').set(comoA());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ empresaId: A.id });
    });

    it('con un UUID válido de una empresa que no existe, corre con ese contexto y no ve datos', async () => {
      const fantasma = randomUUID();
      const contextoRes = await http().get('/sonda-contexto').set('x-empresa-id', fantasma);
      expect(contextoRes.body).toEqual({ empresaId: fantasma });
      const lista = await http().get('/sucursales').set('x-empresa-id', fantasma);
      expect(lista.status).toBe(200);
      expect(lista.body).toEqual([]);
    });

    it.each([
      ['sin la cabecera', undefined],
      ['con un valor que no es UUID', 'no-es-un-uuid'],
      ['con la cabecera vacía', ''],
    ])('%s responde 401 EMPRESA_NO_RESUELTA', async (_nombre, valor) => {
      const peticion = http().get('/sucursales');
      const res = await (valor === undefined ? peticion : peticion.set('x-empresa-id', valor));
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ codigo: 'EMPRESA_NO_RESUELTA' });
    });
  });

  describe('criterio 39 · PATCH /sucursales/:id con cambios válidos', () => {
    it('cambia emisor, código, nombre, dirección, horario, WhatsApp y hora de corte, y actualizadoEn cambia', async () => {
      const sucursal = A.sucursales[0]!;
      const otroEmisor = A.emisores.find((e) => e.id !== sucursal.emisorId)!;
      const antes = sucursalRespuestaSchema.parse(
        (await http().get(`/sucursales/${sucursal.id}`).set(comoA())).body,
      );

      const cambios = {
        emisorId: otroEmisor.id,
        codigoEstablecimiento: '0007',
        nombre: textoUnico('Renombrada'),
        direccion: 'Av. Nueva 999, Miraflores',
        horario: [
          { dia: 1, desde: '09:00', hasta: '22:00' },
          { dia: 5, desde: '18:00', hasta: '02:00' },
        ],
        whatsapp: '+51987654321',
        horaCorte: '04:30',
      };
      const res = await http().patch(`/sucursales/${sucursal.id}`).set(comoA()).send(cambios);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const despues = sucursalRespuestaSchema.parse(res.body);
      expect(despues).toMatchObject({ id: sucursal.id, empresaId: A.id, ...cambios });
      expect(despues.creadoEn).toBe(antes.creadoEn);
      expect(Date.parse(despues.actualizadoEn)).toBeGreaterThan(Date.parse(antes.actualizadoEn));

      const leida = await http().get(`/sucursales/${sucursal.id}`).set(comoA());
      expect(leida.body).toEqual(res.body);
    });

    it('los campos no enviados no cambian', async () => {
      const sucursal = A.sucursales[0]!;
      const antes = sucursalRespuestaSchema.parse(
        (await http().get(`/sucursales/${sucursal.id}`).set(comoA())).body,
      );
      const res = await http()
        .patch(`/sucursales/${sucursal.id}`)
        .set(comoA())
        .send({ direccion: 'Solo cambia la dirección 1' });
      expect(res.status).toBe(200);
      const despues = sucursalRespuestaSchema.parse(res.body);
      expect(despues).toEqual({
        ...antes,
        direccion: 'Solo cambia la dirección 1',
        actualizadoEn: despues.actualizadoEn,
      });
      expect(Date.parse(despues.actualizadoEn)).toBeGreaterThan(Date.parse(antes.actualizadoEn));
    });

    it('el WhatsApp se puede quitar con null', async () => {
      const id = A.sucursales[0]!.id;
      const puesto = await http()
        .patch(`/sucursales/${id}`)
        .set(comoA())
        .send({ whatsapp: '+51912345678' });
      expect(puesto.status).toBe(200);
      expect(puesto.body.whatsapp).toBe('+51912345678');
      const quitado = await http().patch(`/sucursales/${id}`).set(comoA()).send({ whatsapp: null });
      expect(quitado.status).toBe(200);
      expect(quitado.body.whatsapp).toBeNull();
    });

    it('repetir el mismo PATCH da el mismo resultado', async () => {
      const id = A.sucursales[0]!.id;
      const cambios = { direccion: 'Idempotente 123', horaCorte: '03:15' };
      const primera = await http().patch(`/sucursales/${id}`).set(comoA()).send(cambios);
      const segunda = await http().patch(`/sucursales/${id}`).set(comoA()).send(cambios);
      expect(primera.status).toBe(200);
      expect(segunda.status).toBe(200);
      expect(segunda.body).toMatchObject(cambios);
      expect({ ...segunda.body, actualizadoEn: null }).toEqual({
        ...primera.body,
        actualizadoEn: null,
      });
    });
  });

  describe('criterio 40 · PATCH inválido o en conflicto', () => {
    const invalidos: [string, unknown, string | null][] = [
      ['nombre vacío', { nombre: '' }, 'nombre'],
      ['nombre de más de 100 caracteres', { nombre: 'x'.repeat(101) }, 'nombre'],
      [
        'código de establecimiento con 3 dígitos',
        { codigoEstablecimiento: '123' },
        'codigoEstablecimiento',
      ],
      [
        'código de establecimiento con letras',
        { codigoEstablecimiento: 'abcd' },
        'codigoEstablecimiento',
      ],
      ['dirección vacía', { direccion: '' }, 'direccion'],
      ['WhatsApp mal formado', { whatsapp: '987654321' }, 'whatsapp'],
      ['hora de corte inexistente', { horaCorte: '25:00' }, 'horaCorte'],
      ['hora de corte sin cero inicial', { horaCorte: '5:00' }, 'horaCorte'],
      ['emisorId que no es UUID', { emisorId: 'no-es-uuid' }, 'emisorId'],
      [
        'tramo con desde igual a hasta',
        { horario: [{ dia: 1, desde: '10:00', hasta: '10:00' }] },
        'horario',
      ],
      [
        'tramos solapados el mismo día',
        {
          horario: [
            { dia: 2, desde: '09:00', hasta: '15:00' },
            { dia: 2, desde: '14:00', hasta: '20:00' },
          ],
        },
        'horario',
      ],
      ['día fuera de 1 a 7', { horario: [{ dia: 8, desde: '09:00', hasta: '10:00' }] }, 'horario'],
      ['cuerpo vacío', {}, null],
    ];

    it.each(invalidos)(
      '%s responde 400 DATOS_INVALIDOS con la lista de campos',
      async (_nombre, cuerpo, campo) => {
        const id = A.sucursales[0]!.id;
        const antes = await fotoDeFila(plataforma, 'sucursal', id);
        const res = await http()
          .patch(`/sucursales/${id}`)
          .set(comoA())
          .send(cuerpo as object);
        expect(res.status, JSON.stringify(res.body)).toBe(400);
        expect(res.body.codigo).toBe('DATOS_INVALIDOS');
        expect(Array.isArray(res.body.campos)).toBe(true);
        expect(res.body.campos.length).toBeGreaterThan(0);
        if (campo !== null) {
          expect(res.body.campos.some((c: { campo: string }) => c.campo.startsWith(campo))).toBe(
            true,
          );
        }
        expect(await fotoDeFila(plataforma, 'sucursal', id)).toEqual(antes);
      },
    );

    it('un id de ruta que no es UUID responde 400 DATOS_INVALIDOS', async () => {
      const lectura = await http().get('/sucursales/no-es-uuid').set(comoA());
      const cambio = await http()
        .patch('/sucursales/no-es-uuid')
        .set(comoA())
        .send({ nombre: 'X' });
      for (const res of [lectura, cambio]) {
        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('DATOS_INVALIDOS');
      }
    });

    it('un código de establecimiento que ya usa otra sucursal del mismo emisor responde 409 CONFLICTO', async () => {
      // A.sucursales[0] y [2] son del mismo emisor, con códigos 0001 y 0002.
      const [s0, , s2] = A.sucursales;
      expect(s2!.emisorId).toBe(s0!.emisorId);
      const res = await http()
        .patch(`/sucursales/${s2!.id}`)
        .set(comoA())
        .send({ codigoEstablecimiento: s0!.codigoEstablecimiento });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.codigo).toBe('CONFLICTO');
    });

    it('un nombre que ya usa otra sucursal de la empresa (sin distinguir mayúsculas) responde 409 CONFLICTO', async () => {
      const [s0, s1] = A.sucursales;
      const res = await http()
        .patch(`/sucursales/${s1!.id}`)
        .set(comoA())
        .send({ nombre: s0!.nombre.toUpperCase() });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.codigo).toBe('CONFLICTO');
    });

    it('un nombre que solo usa una sucursal de otra empresa no es conflicto', async () => {
      const res = await http()
        .patch(`/sucursales/${A.sucursales[0]!.id}`)
        .set(comoA())
        .send({ nombre: B.sucursales[0]!.nombre });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.nombre).toBe(B.sucursales[0]!.nombre);
    });
  });
});

describe('criterio 31 · cabecera x-empresa-id con NODE_ENV=development', () => {
  let app: INestApplication;
  let A: EmpresaSql;

  beforeAll(async () => {
    fijarEntornoDePrueba({ nodeEnv: 'development' });
    app = await crearAplicacion({ controladoresExtra: SONDAS, logger: false });
    A = await crearEmpresaSql(plataforma);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('con un UUID válido la petición corre con ese contexto; sin la cabecera o con un valor inválido responde 401', async () => {
    const server = app.getHttpServer();
    const conCabecera = await request(server).get('/sucursales').set('x-empresa-id', A.id);
    expect(conCabecera.status).toBe(200);
    expect(ids(conCabecera.body)).toEqual(ids(A.sucursales));

    for (const res of [
      await request(server).get('/sucursales'),
      await request(server).get('/sucursales').set('x-empresa-id', 'no-es-un-uuid'),
    ]) {
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ codigo: 'EMPRESA_NO_RESUELTA' });
    }
  });
});

describe('criterio 30 · NODE_ENV=production sin EMPRESA_POR_HEADER', () => {
  let app: INestApplication;
  let A: EmpresaSql;

  beforeAll(async () => {
    fijarEntornoDePrueba({ nodeEnv: 'production', empresaPorHeader: false });
    app = await crearAplicacion({ controladoresExtra: SONDAS, logger: false });
    A = await crearEmpresaSql(plataforma);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('la cabecera x-empresa-id de una empresa real se ignora: 401 EMPRESA_NO_RESUELTA', async () => {
    const server = app.getHttpServer();
    for (const ruta of ['/sucursales', `/sucursales/${A.sucursales[0]!.id}`, '/sonda-contexto']) {
      const res = await request(server).get(ruta).set('x-empresa-id', A.id);
      expect(res.status, ruta).toBe(401);
      expect(res.body, ruta).toMatchObject({ codigo: 'EMPRESA_NO_RESUELTA' });
    }
    const modificacion = await request(server)
      .patch(`/sucursales/${A.sucursales[0]!.id}`)
      .set('x-empresa-id', A.id)
      .send({ direccion: 'Desde producción' });
    expect(modificacion.status).toBe(401);
  });

  it('una ruta @SinEmpresa() sigue respondiendo', async () => {
    const res = await request(app.getHttpServer()).get('/sonda-libre');
    expect(res.status).toBe(200);
  });
});

describe('criterio 29 · NODE_ENV=production con EMPRESA_POR_HEADER=habilitado', () => {
  it('la API no arranca y el error explica que está prohibido en producción', async () => {
    fijarEntornoDePrueba({ nodeEnv: 'production', empresaPorHeader: true });
    let app: INestApplication | null = null;
    try {
      app = await crearAplicacion({ logger: false }).catch((error: unknown) => {
        expect(String(error instanceof Error ? error.message : error)).toMatch(
          /prohibido en producción/,
        );
        return null;
      });
      expect(app, 'la API arrancó en producción con EMPRESA_POR_HEADER=habilitado').toBeNull();
    } finally {
      await app?.close();
      fijarEntornoDePrueba();
    }
  });
});
