import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guardarArchivoPrivado } from '../scripts/lib/archivo-privado';

// Historia 004, 3b, ronda 1 del ataque: `pnpm puente:simular` guarda la credencial del puente con permisos 0600, también
// cuando el archivo ya existía con otros permisos. No usa la base de datos.

let carpeta: string;

beforeAll(async () => {
  carpeta = await mkdtemp(join(tmpdir(), 'archivo-privado-'));
});

afterAll(async () => {
  await rm(carpeta, { recursive: true, force: true });
});

const permisos = async (archivo: string): Promise<number> => (await stat(archivo)).mode & 0o777;

describe('guardarArchivoPrivado', () => {
  it('un archivo nuevo queda en 0600', async () => {
    const archivo = join(carpeta, 'nuevo.json');
    await guardarArchivoPrivado(archivo, '{"token":"pu.x"}\n');
    expect(await permisos(archivo)).toBe(0o600);
    expect(await readFile(archivo, 'utf8')).toBe('{"token":"pu.x"}\n');
  });

  it('un archivo que ya existía con permisos abiertos se cierra a 0600 y se reescribe', async () => {
    const archivo = join(carpeta, 'viejo.json');
    await writeFile(archivo, 'viejo', { mode: 0o644 });
    expect(await permisos(archivo)).toBe(0o644);
    await guardarArchivoPrivado(archivo, 'secreto');
    expect(await permisos(archivo)).toBe(0o600);
    expect(await readFile(archivo, 'utf8')).toBe('secreto');
  });
});
