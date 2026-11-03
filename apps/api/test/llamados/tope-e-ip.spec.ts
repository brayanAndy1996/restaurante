// Historia 005, grupo C2 · el tope de creaciones en curso por código y la IP del cliente (criterio 33 y plan "Crear un
// llamado"): pruebas del desarrollador (no protegidas). Cubren `TopeDeCreaciones` (5 ids distintos en curso por
// código, las réplicas del mismo id y el mismo cuerpo nunca se rechazan, se libera al terminar) y `ipDelCliente` / `huellaDeIp`
// (la cabecera de `CABECERA_IP_CLIENTE`, su primer valor, la IP de la conexión como respaldo, `X-Forwarded-For`
// ignorada, la IP en su forma canónica, la huella estable por conexión (IPv4 completa, IPv6 por su /64) y sin la IP).
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
const CUERPO = 'huella-del-cuerpo';
const OTRO_CUERPO = 'huella-de-otro-cuerpo';

describe('TopeDeCreaciones', () => {
  it('acepta hasta 5 creaciones en curso con ids distintos por código y rechaza la sexta con 429 de 1 segundo', () => {
    const tope = new TopeDeCreaciones();
    expect(MAXIMO_CREACIONES_POR_CODIGO).toBe(5);
    const soltar = Array.from({ length: 5 }, () => tope.entrar(CODIGO, randomUUID(), CUERPO));
    let error: unknown;
    try {
      tope.entrar(CODIGO, randomUUID(), CUERPO);
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
    const soltar = Array.from({ length: 5 }, () => tope.entrar(CODIGO, randomUUID(), CUERPO));
    expect(() => tope.entrar(OTRO_CODIGO, randomUUID(), CUERPO)).not.toThrow();
    soltar.forEach((s) => s());
  });

  it('una réplica con el mismo id (aun en mayúsculas) nunca se rechaza, ni con el tope lleno', () => {
    const tope = new TopeDeCreaciones();
    const id = randomUUID();
    const soltar = [tope.entrar(CODIGO, id, CUERPO)];
    for (let i = 0; i < 4; i += 1) soltar.push(tope.entrar(CODIGO, randomUUID(), CUERPO));
    for (let i = 0; i < 20; i += 1) soltar.push(tope.entrar(CODIGO, id.toUpperCase(), CUERPO));
    expect(() => tope.entrar(CODIGO, randomUUID(), CUERPO)).toThrow(ErrorAplicacion);
    soltar.forEach((s) => s());
  });

  it('el mismo id con otro cuerpo no es una réplica: cada petición así cuenta para el tope', () => {
    const tope = new TopeDeCreaciones();
    const id = randomUUID();
    const soltar = [tope.entrar(CODIGO, id, CUERPO)];
    // Cuatro peticiones con el mismo id y otro cuerpo (aunque sea el mismo entre ellas) ocupan cuatro lugares más.
    for (let i = 0; i < 4; i += 1) soltar.push(tope.entrar(CODIGO, id, OTRO_CUERPO));
    expect(() => tope.entrar(CODIGO, id, OTRO_CUERPO)).toThrow(ErrorAplicacion);
    expect(() => tope.entrar(CODIGO, randomUUID(), CUERPO)).toThrow(ErrorAplicacion);
    // La réplica exacta (mismo id y mismo cuerpo que la primera) sigue pasando con el tope lleno.
    for (let i = 0; i < 10; i += 1) soltar.push(tope.entrar(CODIGO, id, CUERPO));
    // Al soltar una ajena, vuelve a haber un lugar.
    soltar[1]!();
    expect(() => tope.entrar(CODIGO, randomUUID(), CUERPO)).not.toThrow();
    soltar.forEach((s) => s());
  });

  it('lo ajeno se libera sin dejar memoria y la duena se libera al soltar todas sus réplicas', () => {
    const tope = new TopeDeCreaciones();
    const id = randomUUID();
    const duena = tope.entrar(CODIGO, id, CUERPO);
    const replica = tope.entrar(CODIGO, id, CUERPO);
    const ajena = tope.entrar(CODIGO, id, OTRO_CUERPO);
    duena();
    ajena();
    expect((tope as unknown as { enCurso: Map<string, unknown> }).enCurso.size).toBe(1);
    replica();
    expect((tope as unknown as { enCurso: Map<string, unknown> }).enCurso.size).toBe(0);
  });

  it('soltar libera el lugar, solo una vez por reserva, y no deja memoria', () => {
    const tope = new TopeDeCreaciones();
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const soltar = ids.map((id) => tope.entrar(CODIGO, id, CUERPO));
    soltar[0]!();
    soltar[0]!(); // soltar dos veces no libera el lugar de otro
    expect(() => tope.entrar(CODIGO, randomUUID(), CUERPO)).not.toThrow();
    expect(() => tope.entrar(CODIGO, randomUUID(), CUERPO)).toThrow(ErrorAplicacion);
    soltar.forEach((s) => s());
    expect((tope as unknown as { enCurso: Map<string, unknown> }).enCurso.size).toBe(1);
  });

  it('un id con varias peticiones en curso sigue ocupando un solo lugar hasta que se suelten todas', () => {
    const tope = new TopeDeCreaciones();
    const id = randomUUID();
    const a = tope.entrar(CODIGO, id, CUERPO);
    const b = tope.entrar(CODIGO, id, CUERPO);
    const otros = Array.from({ length: 4 }, () => tope.entrar(CODIGO, randomUUID(), CUERPO));
    a();
    // `b` sigue en curso: su lugar no se libera todavía.
    expect(() => tope.entrar(CODIGO, randomUUID(), CUERPO)).toThrow(ErrorAplicacion);
    b();
    expect(() => tope.entrar(CODIGO, randomUUID(), CUERPO)).not.toThrow();
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

  it('una IPv6 sale en una sola forma canónica, venga escrita como venga', () => {
    const iguales = [
      '2001:db8::1',
      '2001:DB8::1',
      '2001:0db8:0000:0000:0000:0000:0000:0001',
      '2001:db8:0:0:0:0:0:1',
      '2001:0db8::0001',
      '2001:db8::0.0.0.1',
    ];
    for (const escrita of iguales) {
      expect(normalizarIp(escrita), escrita).toBe('2001:db8::1');
      expect(ipDelCliente(peticion({ 'cf-connecting-ip': escrita }), 'cf-connecting-ip')).toBe(
        '2001:db8::1',
      );
    }
    expect(normalizarIp('::1')).toBe('::1');
    expect(normalizarIp('::')).toBe('::');
    expect(normalizarIp('fe80::1%eth0')).toBe('fe80::1');
    // El tramo de ceros más largo es el que se comprime; si empatan, el primero.
    expect(normalizarIp('2001:0:0:1:0:0:0:1')).toBe('2001:0:0:1::1');
    expect(normalizarIp('2001:db8:0:0:1:0:0:1')).toBe('2001:db8::1:0:0:1');
    // Un solo grupo de ceros no se comprime.
    expect(normalizarIp('2001:db8:0:1:1:1:1:1')).toBe('2001:db8:0:1:1:1:1:1');
  });

  it('una IPv4 sobre IPv6 es la misma IPv4 en cualquiera de sus formas', () => {
    for (const escrita of [
      '::ffff:203.0.113.9',
      '::FFFF:203.0.113.9',
      '::ffff:cb00:7109',
      '0:0:0:0:0:ffff:cb00:7109',
      '0000:0000:0000:0000:0000:ffff:203.0.113.9',
    ]) {
      expect(normalizarIp(escrita), escrita).toBe('203.0.113.9');
    }
    // Pero `::1.2.3.4` (compatible, sin `ffff`) no es una IPv4 mapeada.
    expect(normalizarIp('::1.2.3.4')).toBe('::102:304');
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

  it('la misma IPv6 escrita de otra forma da la misma huella', () => {
    const a = huellaDeIp(clave, '2001:db8:0:1:0:0:0:5');
    expect(huellaDeIp(clave, '2001:0DB8:0:1::5').equals(a)).toBe(true);
    expect(huellaDeIp(clave, '2001:db8:0:1:0000:0000:0000:0005').equals(a)).toBe(true);
  });

  it('en IPv6 la huella es la del prefijo /64: otra dirección del mismo /64 cuenta como la misma conexión', () => {
    const a = huellaDeIp(clave, '2001:db8:aaaa:bbbb::1');
    expect(huellaDeIp(clave, '2001:db8:aaaa:bbbb:1234:5678:9abc:def0').equals(a)).toBe(true);
    expect(huellaDeIp(clave, '2001:db8:aaaa:bbbb:ffff:ffff:ffff:ffff').equals(a)).toBe(true);
    // Otro /64 es otra conexión (cualquiera de los cuatro primeros grupos).
    expect(huellaDeIp(clave, '2001:db8:aaaa:bbbc::1').equals(a)).toBe(false);
    expect(huellaDeIp(clave, '2001:db8:aaab:bbbb::1').equals(a)).toBe(false);
    expect(huellaDeIp(clave, '2001:db9:aaaa:bbbb::1').equals(a)).toBe(false);
    // Una IPv4 no se confunde con una IPv6.
    expect(huellaDeIp(clave, '203.0.113.9').equals(a)).toBe(false);
  });

  it('la IPv4 mapeada en hexadecimal da la misma huella que la IPv4', () => {
    expect(huellaDeIp(clave, '::ffff:cb00:7109').equals(huellaDeIp(clave, '203.0.113.9'))).toBe(
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
