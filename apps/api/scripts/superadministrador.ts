// pnpm plataforma:superadmin crear <usuario> "<nombre>"   -> crea un superadministrador
// pnpm plataforma:superadmin desactivar <usuario>         -> lo desactiva y cierra sus sesiones
// pnpm plataforma:superadmin desbloquear <usuario>        -> levanta el bloqueo por intentos fallidos
//
// Son las únicas vías para crearlos, desactivarlos y desbloquearlos (no hay ruta HTTP). La contraseña de `crear` se pide
// por la entrada estándar (sin mostrarla si hay terminal) o, solo para automatizar, por la variable
// SUPERADMIN_CONTRASENA; nunca va como argumento. Cada operación deja su fila de auditoría con el actor
// `cli:superadmin`. Usa la conexión de plataforma (DATABASE_PLATAFORMA_URL, o derivada de
// DATABASE_ADMIN_URL).
import { createInterface } from 'node:readline';
import { prepararEntornoDeScript } from './lib/entorno-scripts';
import {
  crearSuperadministrador,
  desactivarSuperadministrador,
  desbloquearSuperadministrador,
} from './lib/superadministrador';

const USO = `Uso:
  pnpm plataforma:superadmin crear <usuario> "<nombre>"
  pnpm plataforma:superadmin desactivar <usuario>
  pnpm plataforma:superadmin desbloquear <usuario>

La contraseña de "crear" se lee de la entrada estándar (o de SUPERADMIN_CONTRASENA).`;

/** Lee la contraseña: de SUPERADMIN_CONTRASENA, de la terminal sin mostrarla, o de una línea de la entrada. */
async function leerContrasena(): Promise<string> {
  const deEntorno = process.env.SUPERADMIN_CONTRASENA;
  if (deEntorno) return deEntorno;
  if (!process.stdin.isTTY) {
    const lector = createInterface({ input: process.stdin });
    for await (const linea of lector) {
      lector.close();
      return linea;
    }
    return '';
  }
  return new Promise<string>((resolver) => {
    const lector = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const salida = lector as unknown as { _writeToOutput: (texto: string) => void };
    process.stdout.write('Contraseña (8 a 128 caracteres): ');
    // Con la terminal activa el eco lo escribe `_writeToOutput`: se calla mientras se escribe.
    salida._writeToOutput = () => undefined;
    lector.question('', (respuesta) => {
      lector.close();
      process.stdout.write('\n');
      resolver(respuesta);
    });
  });
}

async function main() {
  prepararEntornoDeScript();
  const [orden, usuario, ...resto] = process.argv.slice(2);
  if (orden === 'crear' && usuario && resto.length > 0) {
    const nombre = resto.join(' ');
    const contrasena = await leerContrasena();
    const { id } = await crearSuperadministrador({ usuario, nombre, contrasena });
    console.log(`Superadministrador creado: ${usuario.toLowerCase()} (${id})`);
    return;
  }
  if (orden === 'desactivar' && usuario && resto.length === 0) {
    await desactivarSuperadministrador({ usuario });
    console.log(`Superadministrador desactivado: ${usuario.toLowerCase()}`);
    return;
  }
  if (orden === 'desbloquear' && usuario && resto.length === 0) {
    await desbloquearSuperadministrador({ usuario });
    console.log(`Superadministrador desbloqueado: ${usuario.toLowerCase()}`);
    return;
  }
  console.error(USO);
  process.exit(2);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
