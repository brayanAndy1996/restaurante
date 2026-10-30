// pnpm puente:simular --qr "<texto del QR>" [--emulador]
//
// Un puente de impresión de mentira para probar la impresión sin un teléfono Android (historia 004, 3b, criterios
// 134 y 135). Es el `SimuladorPuente` de las pruebas (`test/soporte/puente/`): vincula con el texto del QR que
// muestra Ajustes › Impresión, guarda su credencial `pu.…`, se conecta al espacio `/puente` de Socket.IO, pide y
// manda los trabajos por TCP a las impresoras de red de la sucursal, reporta el resultado y manda el latido.
//
// Con `--emulador` levanta además una impresora ESC/POS falsa (`EmuladorEscPos`) en esta máquina y escribe en la
// consola cada ticket que recibe, como texto. La impresora se crea en la app apuntando al emulador (host
// 127.0.0.1 y el puerto del emulador, 9100 por defecto), antes o después de vincular.
//
// El código del QR es de un solo uso: al vincular, la credencial del puente queda en `--token-archivo` (por
// defecto `.puente-simulador.json`, en la carpeta desde donde se corre; no se versiona). Sin `--qr`, el comando
// reutiliza esa credencial, así que se puede detener y volver a correr sin pedir otro QR. Termina con Ctrl+C.
//
// No usa la base de datos: habla con la API por HTTP y Socket.IO, igual que lo hará la app (entrega 3c).
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { armarQrPuente, leerQrPuente } from '@restaurante/contratos';
import {
  EmuladorEscPos,
  ErrorProtocoloPuente,
  SimuladorPuente,
  type TicketEmulado,
} from '../test/soporte/puente';
import { guardarArchivoPrivado } from './lib/archivo-privado';

const ARCHIVO_POR_DEFECTO = '.puente-simulador.json';
const PUERTO_POR_DEFECTO = 9100;

const AYUDA = `Uso:
  pnpm puente:simular --qr "<texto del QR>" [opciones]
  pnpm puente:simular [opciones]            (reutiliza la credencial guardada en --token-archivo)

Opciones:
  --qr <texto>              Texto del QR de vinculación (restaurante-puente://vincular?api=…&t=vi.…).
  --api <url>               Dónde escucha la API desde esta máquina, si el QR trae otra URL (la pública).
  --emulador                Levanta una impresora ESC/POS falsa y muestra sus tickets en la consola.
  --emulador-host <host>    Dirección del emulador (por defecto 127.0.0.1).
  --emulador-puerto <n>     Puerto del emulador (por defecto ${PUERTO_POR_DEFECTO}).
  --ancho <58|80>           Ancho del papel del emulador (por defecto 80).
  --marcas                  Muestra también la transcripción con marcas ([B], [CENTRADO], [CORTE]…).
  --token-archivo <ruta>    Dónde guarda la credencial del puente (por defecto ${ARCHIVO_POR_DEFECTO}).
  --nombre-equipo <texto>   Nombre del equipo al vincular (por defecto "Simulador de puente").
  --ayuda                   Muestra este texto.
`;

/** Un error de uso o de la API que se explica en una línea, sin pila. */
class ErrorDeUso extends Error {}

const hora = (): string => new Date().toLocaleTimeString('es-PE', { hour12: false });
const escribir = (mensaje: string): void => {
  console.log(`[${hora()}] ${mensaje}`);
};

interface CredencialGuardada {
  api: string;
  token: string;
}

async function leerCredencial(archivo: string): Promise<CredencialGuardada | null> {
  try {
    const dato: unknown = JSON.parse(await readFile(archivo, 'utf8'));
    if (
      typeof dato === 'object' &&
      dato !== null &&
      'api' in dato &&
      'token' in dato &&
      typeof dato.api === 'string' &&
      typeof dato.token === 'string'
    ) {
      return { api: dato.api, token: dato.token };
    }
    return null;
  } catch {
    return null;
  }
}

function mostrarTicket(ticket: TicketEmulado, etiqueta: string, conMarcas: boolean): void {
  const linea = '─'.repeat(Math.max(8, Math.min(ticket.texto.split('\n')[0]?.length ?? 0, 48)));
  console.log('');
  console.log(
    `┌─ Ticket ${ticket.numero} · ${etiqueta}${ticket.completo ? '' : ' · INCOMPLETO'} ${linea}`,
  );
  console.log(ticket.texto);
  console.log(`└─ fin del ticket ${ticket.numero} ${linea}`);
  if (conMarcas) {
    console.log('');
    console.log(ticket.marcado);
  }
  console.log('');
}

async function principal(): Promise<void> {
  const { values } = parseArgs({
    options: {
      qr: { type: 'string' },
      api: { type: 'string' },
      emulador: { type: 'boolean', default: false },
      'emulador-host': { type: 'string', default: '127.0.0.1' },
      'emulador-puerto': { type: 'string', default: String(PUERTO_POR_DEFECTO) },
      ancho: { type: 'string', default: '80' },
      marcas: { type: 'boolean', default: false },
      'token-archivo': { type: 'string', default: ARCHIVO_POR_DEFECTO },
      'nombre-equipo': { type: 'string', default: 'Simulador de puente' },
      ayuda: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });
  if (values.ayuda) {
    console.log(AYUDA);
    return;
  }

  const archivo = resolve(values['token-archivo']);
  const ancho = values.ancho === '58' ? 58 : values.ancho === '80' ? 80 : null;
  if (ancho === null) throw new ErrorDeUso('--ancho debe ser 58 o 80');
  const puertoEmulador = Number(values['emulador-puerto']);
  if (!Number.isInteger(puertoEmulador) || puertoEmulador < 0 || puertoEmulador > 65535) {
    throw new ErrorDeUso('--emulador-puerto debe ser un puerto entre 0 y 65535');
  }

  // El texto del QR trae la URL pública de la API; `--api` la cambia por la que alcanza esta máquina.
  let qr = values.qr;
  if (qr !== undefined) {
    const leido = leerQrPuente(qr);
    if (leido === null) {
      throw new ErrorDeUso(
        'El texto de --qr no es un QR de vinculación (debe empezar con restaurante-puente://vincular?…). ' +
          'Cópialo completo de Ajustes › Impresión, entre comillas.',
      );
    }
    if (values.api !== undefined) qr = armarQrPuente(values.api, leido.token);
  }
  const guardada = qr === undefined ? await leerCredencial(archivo) : null;
  if (qr === undefined && guardada === null) {
    console.error(AYUDA);
    throw new ErrorDeUso(
      `Falta --qr: no hay una credencial guardada en ${archivo}. Pide el código en Ajustes › Impresión › Vincular puente.`,
    );
  }

  let emulador: EmuladorEscPos | null = null;
  let tickets: NodeJS.Timeout | null = null;
  if (values.emulador) {
    try {
      emulador = await EmuladorEscPos.iniciar({
        host: values['emulador-host'],
        puerto: puertoEmulador,
        anchoMm: ancho,
        nombre: 'Emulador',
      });
    } catch (error) {
      throw new ErrorDeUso(
        `No se pudo abrir el emulador en ${values['emulador-host']}:${puertoEmulador}: ${
          error instanceof Error ? error.message : String(error)
        }. Prueba con otro puerto (--emulador-puerto).`,
      );
    }
    escribir(
      `Emulador de impresora de ${ancho} mm escuchando en ${emulador.host}:${emulador.puerto}. ` +
        'Crea la impresora en la app con esa dirección.',
    );
    let mostrados = 0;
    const vigilado = emulador;
    tickets = setInterval(() => {
      while (mostrados < vigilado.tickets.length) {
        mostrarTicket(
          vigilado.tickets[mostrados]!,
          `${vigilado.host}:${vigilado.puerto}`,
          values.marcas,
        );
        mostrados += 1;
      }
    }, 150);
  }

  const guardarToken = async (token: string): Promise<void> => {
    const api = simulador.urlApi;
    if (api === null) return;
    await guardarArchivoPrivado(archivo, `${JSON.stringify({ api, token }, null, 2)}\n`);
    escribir(`Credencial del puente guardada en ${archivo} (no la subas al repositorio).`);
  };
  const simulador = new SimuladorPuente({
    ...(qr !== undefined ? { qr } : { api: guardada!.api, token: guardada!.token }),
    nombreEquipo: values['nombre-equipo'],
    modelo: 'puente:simular',
    versionApp: 'simulador-cli',
    registrar: (mensaje) => escribir(mensaje),
    guardarToken,
  });

  let terminando = false;
  const terminar = async (codigo: number): Promise<void> => {
    if (terminando) return;
    terminando = true;
    escribir('Deteniendo el puente…');
    await simulador.detener();
    if (tickets !== null) clearInterval(tickets);
    if (emulador !== null) await emulador.cerrar();
    process.exit(codigo);
  };
  process.on('SIGINT', () => void terminar(0));
  process.on('SIGTERM', () => void terminar(0));

  try {
    if (qr !== undefined) {
      escribir('Vinculando con el código del QR…');
      await simulador.vincular();
    }
    await simulador.iniciar();
  } catch (error) {
    if (tickets !== null) clearInterval(tickets);
    await simulador.detener().catch(() => undefined);
    await emulador?.cerrar();
    if (error instanceof ErrorProtocoloPuente) {
      if (error.codigo === 'VINCULACION_INVALIDA') {
        throw new ErrorDeUso(
          'El código del QR no sirve: venció (dura 10 minutos), ya se usó o se pidió otro después. ' +
            'Pide un código nuevo en Ajustes › Impresión.',
        );
      }
      if (error.estado === 401) {
        throw new ErrorDeUso(
          `La API no reconoce la credencial del puente (${error.message}). ` +
            `Si lo revocaron o vinculaste otro, borra ${archivo} y vincula con un QR nuevo.`,
        );
      }
      if (error.estado === 0) {
        throw new ErrorDeUso(
          `No se pudo hablar con la API: ${error.message}. Si el QR trae la URL pública, usa --api http://localhost:3000.`,
        );
      }
    }
    throw error;
  }

  const sucursal = simulador.sucursal;
  const impresoras = simulador.configuracion?.impresoras ?? [];
  escribir(
    `Puente conectado a la sucursal ${sucursal?.nombre ?? '?'} (${simulador.urlApi}). ` +
      `Impresoras configuradas: ${impresoras.length}.`,
  );
  for (const impresora of impresoras) {
    const destino =
      impresora.conexion.tipo === 'RED'
        ? `${impresora.conexion.host}:${impresora.conexion.puerto}`
        : `Bluetooth ${impresora.conexion.mac} (el simulador no imprime por Bluetooth)`;
    const alEmulador =
      emulador !== null &&
      impresora.conexion.tipo === 'RED' &&
      impresora.conexion.puerto === emulador.puerto;
    escribir(`  - ${impresora.nombre}: ${destino}${alEmulador ? ' (emulador)' : ''}`);
  }
  if (
    emulador !== null &&
    !impresoras.some((i) => i.conexion.tipo === 'RED' && i.conexion.puerto === emulador.puerto)
  ) {
    escribir(
      `Ninguna impresora apunta al emulador todavía: créala en la app con host ${emulador.host} y puerto ${emulador.puerto}.`,
    );
  }
  escribir('Esperando trabajos de impresión. Ctrl+C para terminar.');

  // Se queda vivo: el simulador mantiene sus propios temporizadores y el socket; solo hay que no salir.
  await new Promise<void>(() => undefined);
}

principal().catch((error: unknown) => {
  if (error instanceof ErrorDeUso) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
