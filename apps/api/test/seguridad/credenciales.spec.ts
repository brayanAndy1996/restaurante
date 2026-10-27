// Pruebas del desarrollador (no protegidas) de T9: contraseñas con scrypt, huella HMAC del PIN, generación
// del PIN único, secretos de sesión y comparación en tiempo constante, y el formato de los tokens.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PIN_PEPPER_LOCAL, type Entorno } from '../../src/config/entorno';
import { Credenciales, iguales } from '../../src/modulos/seguridad/credenciales';
import {
  armarTokenEquipo,
  armarTokenSesion,
  armarTokenSuperadministrador,
  parsearTokenEquipo,
  parsearTokenSesion,
  parsearTokenSuperadministrador,
} from '../../src/modulos/seguridad/tokens';

function credenciales(pepper = PIN_PEPPER_LOCAL): Credenciales {
  return new Credenciales({ PIN_PEPPER: pepper } as Entorno);
}

describe('contraseñas (scrypt)', () => {
  const c = credenciales();

  it('guarda con el formato scrypt$15$8$1$<sal>$<hash> y nunca en claro', async () => {
    const hash = await c.hashContrasena('Clave-segura-123');
    const partes = hash.split('$');
    expect(partes).toHaveLength(6);
    expect(partes.slice(0, 4)).toEqual(['scrypt', '15', '8', '1']);
    expect(Buffer.from(partes[4]!, 'base64')).toHaveLength(16);
    expect(Buffer.from(partes[5]!, 'base64')).toHaveLength(32);
    expect(hash).not.toContain('Clave-segura-123');
  });

  it('la misma contraseña da hashes distintos (sal propia) y ambos verifican', async () => {
    const [a, b] = await Promise.all([
      c.hashContrasena('igual-1234'),
      c.hashContrasena('igual-1234'),
    ]);
    expect(a).not.toBe(b);
    expect(await c.verificarContrasena('igual-1234', a)).toBe(true);
    expect(await c.verificarContrasena('igual-1234', b)).toBe(true);
  });

  it('rechaza una contraseña incorrecta, vacía o con otra mayúscula', async () => {
    const hash = await c.hashContrasena('Clave-segura-123');
    for (const mala of ['clave-segura-123', 'Clave-segura-124', '', ' Clave-segura-123']) {
      expect(await c.verificarContrasena(mala, hash), JSON.stringify(mala)).toBe(false);
    }
  });

  it('sin hash guardado (usuario inexistente) siempre es falso, aunque calcula igual un scrypt', async () => {
    expect(await c.verificarContrasena('cualquiera-1234', null)).toBe(false);
    expect(await c.verificarContrasena('', null)).toBe(false);
  });

  it('un hash con otro formato o parámetros fuera de rango no verifica', async () => {
    for (const hash of [
      '',
      'texto',
      'bcrypt$12$x$y$z$w',
      'scrypt$15$8$1$sal',
      'scrypt$40$8$1$c2Fs$aGFzaA==',
      'scrypt$15$0$1$c2Fs$aGFzaA==',
      'scrypt$15$8$99$c2Fs$aGFzaA==',
      'scrypt$x$8$1$c2Fs$aGFzaA==',
    ]) {
      expect(await c.verificarContrasena('cualquiera-1234', hash), hash).toBe(false);
    }
  });

  it('admite caracteres Unicode y contraseñas largas', async () => {
    const larga = 'ñandú-🍲-'.repeat(15);
    const hash = await c.hashContrasena(larga);
    expect(await c.verificarContrasena(larga, hash)).toBe(true);
    expect(await c.verificarContrasena(larga.slice(0, -1), hash)).toBe(false);
  });
});

describe('PIN (HMAC con el secreto del entorno)', () => {
  const c = credenciales();
  const empresa = randomUUID();

  it('la huella es un HMAC-SHA256 de 32 bytes que depende del PIN, de la empresa y del secreto', () => {
    const huella = c.huellaPin(empresa, '123456');
    expect(huella).toHaveLength(32);
    expect(c.huellaPin(empresa, '123456').equals(huella)).toBe(true);
    expect(c.huellaPin(empresa, '123457').equals(huella)).toBe(false);
    expect(c.huellaPin(randomUUID(), '123456').equals(huella)).toBe(false);
    const otroSecreto = credenciales(Buffer.alloc(32, 9).toString('base64'));
    expect(otroSecreto.huellaPin(empresa, '123456').equals(huella)).toBe(false);
  });

  it('un PIN de 4 y uno de 6 dígitos nunca colisionan (0123 ≠ 000123)', () => {
    expect(c.huellaPin(empresa, '0123').equals(c.huellaPin(empresa, '000123'))).toBe(false);
  });

  it('pinCoincide compara en tiempo constante con la huella guardada', () => {
    const guardada = c.huellaPin(empresa, '4321');
    expect(c.pinCoincide(empresa, '4321', guardada)).toBe(true);
    expect(c.pinCoincide(empresa, '4322', guardada)).toBe(false);
    expect(c.pinCoincide(randomUUID(), '4321', guardada)).toBe(false);
    expect(c.pinCoincide(empresa, '4321', Buffer.alloc(5))).toBe(false);
  });

  it.each([4, 6] as const)(
    'genera un PIN de %i dígitos, con ceros a la izquierda, al azar',
    async (largo) => {
      const vistos = new Set<string>();
      let conCeroAlInicio = false;
      for (let i = 0; i < 400; i++) {
        const { pin, huella } = await c.generarPinUnico(empresa, largo, async () => false);
        expect(pin).toMatch(new RegExp(`^\\d{${largo}}$`));
        expect(huella.equals(c.huellaPin(empresa, pin))).toBe(true);
        vistos.add(pin);
        if (pin.startsWith('0')) conCeroAlInicio = true;
      }
      expect(vistos.size).toBeGreaterThan(300);
      expect(conCeroAlInicio).toBe(true);
    },
  );

  it('no repite un PIN que ya existe: reintenta hasta encontrar uno libre', async () => {
    const ocupadas: string[] = [];
    let llamadas = 0;
    const { pin } = await c.generarPinUnico(empresa, 4, async (huella) => {
      llamadas += 1;
      if (llamadas <= 5) {
        ocupadas.push(huella.toString('hex'));
        return true;
      }
      return false;
    });
    expect(llamadas).toBe(6);
    expect(ocupadas).not.toContain(c.huellaPin(empresa, pin).toString('hex'));
  });

  it('se rinde después de 20 intentos si todo está ocupado', async () => {
    let llamadas = 0;
    await expect(
      c.generarPinUnico(empresa, 4, async () => {
        llamadas += 1;
        return true;
      }),
    ).rejects.toThrow(/PIN/);
    expect(llamadas).toBe(20);
  });
});

describe('secretos de sesión y de equipo', () => {
  const c = credenciales();

  it('el secreto son 32 bytes aleatorios en base64url (43 caracteres) y no se repite', () => {
    const secretos = new Set(Array.from({ length: 200 }, () => c.generarSecreto()));
    expect(secretos.size).toBe(200);
    for (const secreto of secretos) expect(secreto).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('solo se guarda la huella SHA-256 y se compara con el secreto presentado', () => {
    const secreto = c.generarSecreto();
    const huella = c.huellaSecreto(secreto);
    expect(huella).toHaveLength(32);
    expect(huella.toString('hex')).not.toContain(secreto);
    expect(c.secretoCoincide(secreto, huella)).toBe(true);
    expect(c.secretoCoincide(c.generarSecreto(), huella)).toBe(false);
    expect(c.secretoCoincide(secreto, Buffer.alloc(32))).toBe(false);
  });

  it('iguales compara en tiempo constante y rechaza largos distintos sin lanzar', () => {
    expect(iguales(Buffer.from('abc'), Buffer.from('abc'))).toBe(true);
    expect(iguales(Buffer.from('abc'), Buffer.from('abd'))).toBe(false);
    expect(iguales(Buffer.from('abc'), Buffer.from('abcd'))).toBe(false);
  });
});

describe('formato de los tokens', () => {
  const secreto = credenciales().generarSecreto();
  const e = randomUUID();
  const s = randomUUID();

  it('arma y analiza se., sa. y eq. (ida y vuelta)', () => {
    expect(parsearTokenSesion(armarTokenSesion(e, s, secreto))).toEqual({
      empresaId: e,
      sesionId: s,
      secreto,
    });
    expect(parsearTokenSuperadministrador(armarTokenSuperadministrador(s, secreto))).toEqual({
      sesionId: s,
      secreto,
    });
    expect(parsearTokenEquipo(armarTokenEquipo(e, s, secreto))).toEqual({
      empresaId: e,
      equipoId: s,
      secreto,
    });
  });

  it('cada analizador rechaza los tokens de los otros tipos', () => {
    const sesion = armarTokenSesion(e, s, secreto);
    const superadmin = armarTokenSuperadministrador(s, secreto);
    const equipo = armarTokenEquipo(e, s, secreto);
    expect(parsearTokenSesion(superadmin)).toBeNull();
    expect(parsearTokenSesion(equipo)).toBeNull();
    expect(parsearTokenSuperadministrador(sesion)).toBeNull();
    expect(parsearTokenEquipo(sesion)).toBeNull();
  });

  it.each([
    '',
    'se.',
    'esto-no-es-un-token',
    `se.${randomUUID()}.${randomUUID()}`,
    `se.no-es-uuid.${randomUUID()}.${secreto}`,
    `se.${randomUUID().toUpperCase()}.${randomUUID()}.${secreto}`,
    `se.${randomUUID()}.${randomUUID()}.corto`,
    `se.${randomUUID()}.${randomUUID()}.${secreto}x`,
    `se.${randomUUID()}.${randomUUID()}.${secreto}.mas`,
    ` se.${randomUUID()}.${randomUUID()}.${secreto}`,
    `se.${randomUUID()}.${randomUUID()}.${secreto}\n`,
  ])('rechaza un token mal formado: %s', (token) => {
    expect(parsearTokenSesion(token)).toBeNull();
  });
});
