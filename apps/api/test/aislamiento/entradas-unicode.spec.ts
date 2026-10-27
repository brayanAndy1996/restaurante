// spec: 001-base-multitenancy (pruebas protegidas)
//
// Criterio 40c (falla de la ronda 3): un sustituto UTF-16 suelto (por ejemplo `\ud800` o `\udc00`
// escrito como escape en el JSON) en un texto es un dato mal formado, igual que el NUL del criterio
// 40b: `PATCH /sucursales/:id` responde 400 `DATOS_INVALIDOS` indicando el campo y la sucursal no
// cambia (en ningún caso se guarda con U+FFFD ni responde 500). Un par de sustitutos válido (emoji)
// se acepta y se guarda tal cual. Un cuerpo JSON mal formado responde 400 `DATOS_INVALIDOS` con un
// mensaje genérico, sin el texto del analizador de JSON, sin fragmentos del cuerpo ni posiciones, y
// sin ejecutar el controlador.
import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAplicacion } from '../../src/aplicacion';
import { abrirCliente, fijarEntornoDePrueba } from '../utilidades';
import { crearEmpresaSql, fotoDeFila, type EmpresaSql } from './fabrica';

let app: INestApplication;
let plataforma: Client;
let A: EmpresaSql;

beforeAll(async () => {
  fijarEntornoDePrueba();
  app = await crearAplicacion();
  plataforma = await abrirCliente('plataforma');
  A = await crearEmpresaSql(plataforma);
});

afterAll(async () => {
  await app?.close();
  await plataforma?.end();
});

const comoA = () => ({ 'x-empresa-id': A.id, 'content-type': 'application/json' });
const sucursalId = () => A.sucursales[0]!.id;

/** `PATCH /sucursales/:id` con el texto de `cuerpo` enviado tal cual (los escapes `\uXXXX` viajan sin interpretar). */
const patchCrudo = (cuerpo: string, id: string = sucursalId()) =>
  request(app.getHttpServer()).patch(`/sucursales/${id}`).set(comoA()).send(cuerpo);

interface CampoError {
  campo: string;
  mensaje: string;
}

describe('criterio 40c · sustituto UTF-16 suelto en PATCH /sucursales/:id es DATOS_INVALIDOS', () => {
  const CASOS: { nombre: string; campo: 'nombre' | 'direccion'; json: string }[] = [
    { nombre: 'sustituto alto en medio', campo: 'direccion', json: '{"direccion":"Av \\ud800 X"}' },
    { nombre: 'sustituto bajo en medio', campo: 'direccion', json: '{"direccion":"Av \\udc00 X"}' },
    { nombre: 'sustituto alto al final', campo: 'direccion', json: '{"direccion":"Av X\\ud800"}' },
    {
      nombre: 'sustituto bajo al inicio',
      campo: 'direccion',
      json: '{"direccion":"\\udfff Av X"}',
    },
    {
      nombre: 'sustitutos en orden inverso (bajo y luego alto)',
      campo: 'direccion',
      json: '{"direccion":"Av \\ude00\\ud83d X"}',
    },
    {
      nombre: 'sustituto alto en el nombre',
      campo: 'nombre',
      json: '{"nombre":"Sede \\ud800 Sur"}',
    },
    {
      nombre: 'sustituto bajo en el nombre',
      campo: 'nombre',
      json: '{"nombre":"Sede \\udc00 Sur"}',
    },
    {
      nombre: 'sustituto alto seguido de un carácter que no es sustituto bajo',
      campo: 'nombre',
      json: '{"nombre":"Sede \\ud800A"}',
    },
  ];

  it.each(CASOS)(
    '$nombre responde 400 con el campo $campo y la fila no cambia',
    async ({ campo, json }) => {
      const antes = await fotoDeFila(plataforma, 'sucursal', sucursalId());

      const res = await patchCrudo(json);

      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body).toMatchObject({ codigo: 'DATOS_INVALIDOS' });
      const campos = ((res.body.campos ?? []) as CampoError[]).map((c) => c.campo);
      expect(campos).toContain(campo);
      expect(await fotoDeFila(plataforma, 'sucursal', sucursalId())).toEqual(antes);
    },
  );

  it('varios campos con sustitutos sueltos: se listan ambos y nada cambia', async () => {
    const antes = await fotoDeFila(plataforma, 'sucursal', sucursalId());
    const res = await patchCrudo('{"nombre":"A\\ud800","direccion":"B\\udc00"}');
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body).toMatchObject({ codigo: 'DATOS_INVALIDOS' });
    const campos = ((res.body.campos ?? []) as CampoError[]).map((c) => c.campo);
    expect(campos).toEqual(expect.arrayContaining(['nombre', 'direccion']));
    expect(await fotoDeFila(plataforma, 'sucursal', sucursalId())).toEqual(antes);
  });

  it('control · un par de sustitutos válido (emoji) se acepta y se guarda tal cual', async () => {
    const direccion = 'Av. Pizza \u{1F355} 123';
    const res = await patchCrudo(JSON.stringify({ direccion }), A.sucursales[1]!.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.direccion).toBe(direccion);
    const { rows } = await plataforma.query<{ direccion: string }>(
      'SELECT direccion FROM sucursal WHERE id = $1',
      [A.sucursales[1]!.id],
    );
    expect(rows[0]!.direccion).toBe(direccion);
  });

  it('control · el par de sustitutos escrito como escapes (\\ud83d\\ude00) también se acepta', async () => {
    const res = await patchCrudo('{"direccion":"Av. \\ud83d\\ude00 7"}', A.sucursales[1]!.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.direccion).toBe('Av. \u{1F600} 7');
  });
});

describe('criterio 40c · cuerpo JSON mal formado es DATOS_INVALIDOS con un mensaje genérico', () => {
  /** Texto que el analizador de JSON de Node o de Express suele incluir en sus mensajes. */
  const TEXTO_DEL_ANALIZADOR = /JSON|Unexpected|position|token|SyntaxError/i;

  const MALFORMADOS: { nombre: string; cuerpo: string }[] = [
    { nombre: 'objeto cortado', cuerpo: '{"nombre":' },
    { nombre: 'coma final', cuerpo: '{"nombre":"Sede Norte",}' },
    { nombre: 'comillas simples', cuerpo: "{'nombre':'Sede'}" },
    { nombre: 'texto que no es JSON', cuerpo: 'no soy json' },
  ];

  it.each(MALFORMADOS)(
    'PATCH /sucursales/:id con $nombre responde 400 DATOS_INVALIDOS sin el texto del analizador',
    async ({ cuerpo }) => {
      const antes = await fotoDeFila(plataforma, 'sucursal', sucursalId());

      const res = await patchCrudo(cuerpo);

      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body).toMatchObject({ codigo: 'DATOS_INVALIDOS', mensaje: expect.any(String) });
      expect(res.body.mensaje).not.toMatch(TEXTO_DEL_ANALIZADOR);
      expect(JSON.stringify(res.body)).not.toMatch(TEXTO_DEL_ANALIZADOR);
      expect(await fotoDeFila(plataforma, 'sucursal', sucursalId())).toEqual(antes);
    },
  );

  it('el mensaje no repite fragmentos del cuerpo enviado', async () => {
    const secreto = 'fragmento-secreto-40c';
    const res = await patchCrudo(`{"nombre":"${secreto}", roto`);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.codigo).toBe('DATOS_INVALIDOS');
    expect(JSON.stringify(res.body)).not.toContain(secreto);
    expect(JSON.stringify(res.body)).not.toContain('roto');
  });

  it.each([
    ['post', '/health'],
    ['put', '/ruta-que-no-existe'],
    ['post', '/sucursales'],
  ] as const)(
    '%s %s con JSON mal formado responde 400 DATOS_INVALIDOS (cualquier ruta)',
    async (metodo, ruta) => {
      const res = await request(app.getHttpServer())[metodo](ruta).set(comoA()).send('{"x": [1, 2');
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body).toMatchObject({ codigo: 'DATOS_INVALIDOS' });
      expect(JSON.stringify(res.body)).not.toMatch(TEXTO_DEL_ANALIZADOR);
    },
  );

  it('control · un JSON bien formado sigue funcionando en la misma ruta', async () => {
    const res = await patchCrudo('{"direccion":"Calle Control 40c 1"}');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});
