import { chmod, writeFile } from 'node:fs/promises';

/**
 * Escribe un archivo que solo puede leer su dueño (`0600`), por ejemplo la credencial del puente. `mode` de
 * `writeFile` solo vale cuando el archivo se crea: si ya existía con otros permisos (`0644`), los conservaba y el
 * secreto quedaba legible por los demás usuarios. Por eso se cierran los permisos antes de escribir y se
 * confirman después.
 */
export async function guardarArchivoPrivado(archivo: string, contenido: string): Promise<void> {
  await chmod(archivo, 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await writeFile(archivo, contenido, { mode: 0o600 });
  await chmod(archivo, 0o600);
}
