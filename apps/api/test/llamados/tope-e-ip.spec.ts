// Historia 005, grupo C2 · el tope de creaciones en curso por código y la IP del cliente (criterio 33 y plan "Crear un
// llamado"): pruebas del desarrollador (no protegidas). Cubren `TopeDeCreaciones` (5 ids distintos en curso por
// código, las réplicas del mismo id nunca se rechazan, se libera al terminar) y `ipDelCliente` / `huellaDeIp`
// (la cabecera de `CABECERA_IP_CLIENTE`, su primer valor, la IP de la conexión como respaldo, `X-Forwarded-For`
// ignorada, la huella estable y sin la IP).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ErrorAplicacion } from '../../src/nucleo/errores/error-aplicacion';
import {
  derivarClaveHuellaIp,
  huellaDeIp,
  ipDelCliente,
  normalizarIp,
} from '../../src/nucleo/http/ip-cliente';
import {
  MAXIMO_CREACIONES_POR_CODIGO,
  TopeDeCreaciones,
} from '../../src/modulos/llamados/tope-de-creaciones';

const CODIGO = 'AAAAAAAAAAAAAAAAAAAAAA';
const OTRO_CODIGO = 'BBBBBBBBBBBBBBBBBBBBBB';

describe('TopeDeCreaciones', () => {
  it('acepta hasta 5 creaciones en curso con ids distintos por código y rechaza la sexta con 429 de 1 segundo', () => {
    const tope = new TopeDeCreaciones();
    expect(MAXIMO_CREACIONES_POR_CODIGO).toBe(5);
    const soltar = Array.from({ length: 5 }, () => tope.entrar(CODIGO, randomUUID()));
    let error: unknown;
    try {
      tope.entrar(CODIGO, randomUUID());
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorAplicacion);
    expect(error).toMatchObject({ codigo: 'DEMASIADOS_LLAMADOS', reintentarEnSegundos: 1 });
    expect((error as ErrorAplicacion).getStatus()).toBe(429);
    soltar.forEach((s) => s());
  });

  it('cada código tiene su propio tope', () => {
    const tope = new TopeDeCreaciones();
    const soltar = Array.from({ length: 5 }, () => tope.entrar(CODIGO, randomUUID()));
    expect(() => tope.entrar(OTRO_CODIGO, randomUUID())).not.toThrow();
    soltar.forEach((s) => s());
  });

  it('una réplica con el mismo id (aun en mayúsculas) nunca se rechaza, ni con el tope lleno', () => {
    const tope = new TopeDeCreaciones();
    const id = randomUUID();
    const soltar = [tope.entrar(CODIGO, id)];
    for (let i = 0; i < 4; i += 1) soltar.push(tope.entrar(CODIGO, randomUUID()));
    for (let i = 0; i < 20; i += 1) soltar.push(tope.entrar(CODIGO, id.toUpperCase()));
    expect(() => tope.entrar(CODIGO, randomUUID())).toThrow(ErrorAplicacion);
    soltar.forEach((s) => s());
  });

  it('soltar libera el lugar, solo una vez por reserva, y no deja memoria', () => {
    const tope = new TopeDeCreaciones();
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const soltar = ids.map((id) => tope.entrar(CODIGO, id));
    soltar[0]!();
    soltar[0]!(); // soltar dos veces no libera el lugar de otro
    expect(() => tope.entrar(CODIGO, randomUUID())).not.toThrow();
    expect(() => tope.entrar(CODIGO, randomUUID())).toThrow(ErrorAplicacion);
    soltar.forEach((s) => s());
    expect((tope as unknown as { enCurso: Map<string, unknown> }).enCurso.size).toBe(1);
  });

  it('un id con varias peticiones en curso sigue ocupando un solo lugar hasta que se suelten todas', () => {
    const tope = new TopeDeCreaciones();
    const id = randomUUID();
    const a = tope.entrar(CODIGO, id);
    const b = tope.entrar(CODIGO, id);
    const otros = Array.from({ length: 4 }, () => tope.entrar(CODIGO, randomUUID()));
    a();
    // `b` sigue en curso: su lugar no se libera todavía.
    expect(() => tope.entrar(CODIGO, randomUUID())).toThrow(ErrorAplicacion);
    b();
    expect(() => tope.entrar(CODIGO, randomUUID())).not.toThrow();
    otros.forEach((s) => s());
  });
});

describe('ipDelCliente', () => {
  const peticion = (
    headers: Record<string, string | string[] | undefined>,
    remoteAddress?: string,
  ) => ({ headers, socket: { remoteAddress } });

  it('con la cabecera configurada usa su primer valor', () => {
    expect(
      ipDelCliente(
        peticion({ 'cf-connecting-ip': '203.0.113.9, 10.0.0.1' }, '10.0.0.2'),
        'cf-connecting-ip',
      ),
    ).toBe('203.0.113.9');
    expect(
      ipDelCliente(peticion({ 'cf-connecting-ip': ['198.51.100.4'] }), 'CF-Connecting-IP'),
    ).toBe('198.51.100.4');
  });

  it('sin la cabecera, o sin variable, usa la IP de la conexión', () => {
    expect(ipDelCliente(peticion({}, '10.0.0.2'), 'cf-connecting-ip')).toBe('10.0.0.2');
    expect(
      ipDelCliente(peticion({ 'cf-connecting-ip': '203.0.113.9' }, '10.0.0.2'), undefined),
    ).toBe('10.0.0.2');
  });

  it('una cabecera que no es una IP se ignora y vale la conexión', () => {
    for (const mala of ['', 'no-soy-una-ip', '999.1.1.1', '1.2.3', "1.2.3.4'; DROP TABLE x"]) {
      expect(
        ipDelCliente(peticion({ 'cf-connecting-ip': mala }, '10.0.0.2'), 'cf-connecting-ip'),
      ).toBe('10.0.0.2');
    }
  });

  it('X-Forwarded-For y Forwarded no engañan: solo vale la cabecera configurada', () => {
    const ip = ipDelCliente(
      peticion({ 'x-forwarded-for': '203.0.113.77', forwarded: 'for=203.0.113.78' }, '10.0.0.2'),
      'cf-connecting-ip',
    );
    expect(ip).toBe('10.0.0.2');
  });

  it('una IPv4 escrita como IPv6 se reduce a su IPv4, venga de la cabecera o de la conexión', () => {
    expect(ipDelCliente(peticion({}, '::ffff:10.0.0.2'), undefined)).toBe('10.0.0.2');
    expect(
      ipDelCliente(peticion({ 'cf-connecting-ip': '::FFFF:203.0.113.9' }), 'cf-connecting-ip'),
    ).toBe('203.0.113.9');
    expect(normalizarIp('2001:DB8::1')).toBe('2001:db8::1');
  });

  it('sin ninguna IP devuelve undefined', () => {
    expect(ipDelCliente(peticion({}), 'cf-connecting-ip')).toBeUndefined();
  });
});

describe('huellaDeIp', () => {
  const pepper = Buffer.from('pepper-de-prueba-de-32-bytes-ok!!').toString('base64');
  const clave = derivarClaveHuellaIp(pepper);

  it('son 32 bytes, estable para la misma IP, distinta para otra y sin la IP dentro', () => {
    const a = huellaDeIp(clave, '203.0.113.9');
    expect(a).toHaveLength(32);
    expect(huellaDeIp(clave, '203.0.113.9').equals(a)).toBe(true);
    expect(huellaDeIp(clave, '203.0.113.10').equals(a)).toBe(false);
    expect(a.toString('hex')).not.toBe(Buffer.from('203.0.113.9').toString('hex'));
    expect(a.includes(Buffer.from('203.0.113.9'))).toBe(false);
  });

  it('la IPv4 sobre IPv6 da la misma huella que la IPv4', () => {
    expect(huellaDeIp(clave, '::ffff:203.0.113.9').equals(huellaDeIp(clave, '203.0.113.9'))).toBe(
      true,
    );
  });

  it('depende del secreto: otro PIN_PEPPER da otra huella, y la clave no es el pepper', () => {
    const otra = derivarClaveHuellaIp(
      Buffer.from('otro-pepper-de-32-bytes-de-prueba!').toString('base64'),
    );
    expect(huellaDeIp(otra, '203.0.113.9').equals(huellaDeIp(clave, '203.0.113.9'))).toBe(false);
    expect(clave.equals(Buffer.from(pepper, 'base64'))).toBe(false);
  });

  it('sin PIN_PEPPER no se puede derivar la clave', () => {
    expect(() => derivarClaveHuellaIp(undefined)).toThrow(/PIN_PEPPER/);
  });
});
