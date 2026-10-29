import { Logger } from '@nestjs/common';
import { createAdapter } from '@socket.io/postgres-adapter';
import { Client, Pool, type ClientConfig } from 'pg';

/** Tabla auxiliar del adaptador, en el esquema `tiempo_real` (migración `202610300004-tiempo-real.ts`). */
export const TABLA_DEL_ADAPTADOR = 'tiempo_real.socket_io_attachments';

/** Conexiones del pool del adaptador: una queda escuchando (`LISTEN`) y la otra publica (`pg_notify`). */
export const CONEXIONES_DEL_ADAPTADOR = 2;

/** Canal de PostgreSQL del espacio `/` (`<prefijo>#<espacio>`, con el prefijo por defecto del adaptador). */
export const CANAL_DEL_ESPACIO_PWA = 'socket.io#/';

/** Cuánto se espera a que el pool suelte sus conexiones al apagar antes de cerrarlas a la fuerza. */
const ESPERA_DE_CIERRE_MS = 1_500;

const logger = new Logger('AdaptadorTiempoReal');

const pausa = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

/**
 * El pool del adaptador de Socket.IO (criterio 70): se conecta con el rol `restaurante_tiempo_real`
 * (`DATABASE_TIEMPO_REAL_URL`), que no tiene privilegios sobre las tablas de `public`. No es la conexión de la API
 * ni pasa por su guarda (`LISTEN` y `pg_notify` están prohibidos ahí).
 */
export class PoolDelAdaptador {
  readonly pool: Pool;
  private readonly clientes = new Set<Client>();

  constructor(url: string) {
    const clientes = this.clientes;
    /**
     * Cliente de `pg` que no tumba el proceso si la conexión se cae. El adaptador toma una conexión del pool y no
     * la suelta mientras escucha el canal; el pool solo vigila las que están libres, así que sin un oyente de
     * `error` una caída de la base lanzaría una excepción sin captura. El adaptador reconecta solo (`end`).
     */
    class ClienteDelAdaptador extends Client {
      constructor(configuracion?: ClientConfig) {
        super(configuracion);
        clientes.add(this);
        this.on('error', (error: Error) => {
          logger.warn(`Se perdió una conexión del adaptador de tiempo real: ${error.message}`);
        });
        this.once('end', () => clientes.delete(this));
      }
    }
    this.pool = new Pool({
      connectionString: url,
      max: CONEXIONES_DEL_ADAPTADOR,
      application_name: 'restaurante-tiempo-real',
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      Client: ClienteDelAdaptador,
    });
    this.pool.on('error', (error: Error) => {
      logger.warn(`Error en una conexión libre del adaptador de tiempo real: ${error.message}`);
    });
  }

  /**
   * Adaptador de Socket.IO sobre PostgreSQL (`LISTEN`/`NOTIFY`): reparte entre las instancias de la API los
   * eventos y las desconexiones. Los mensajes grandes van por la tabla auxiliar; los eventos llevan solo ids, así
   * que el `NOTIFY` casi nunca los necesita (criterio 69).
   */
  crearAdaptador(): ReturnType<typeof createAdapter> {
    return createAdapter(this.pool, {
      tableName: TABLA_DEL_ADAPTADOR,
      errorHandler: (error: unknown) => {
        logger.warn(
          `Falló el adaptador de tiempo real: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    });
  }

  /**
   * Espera a que alguna conexión del pool esté escuchando el canal. Sin esto, un evento publicado por otra
   * instancia justo después de arrancar se perdería, y un cierre inmediato dejaría una conexión sin soltar.
   * Si no se logra en `ms`, deja un aviso y sigue: el adaptador reintenta solo.
   */
  async esperarEscucha(canal: string, ms = 5_000): Promise<void> {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      for (const cliente of [...this.clientes]) {
        try {
          const { rowCount } = await cliente.query(
            'SELECT 1 FROM pg_listening_channels() AS c WHERE c = $1',
            [canal],
          );
          if (rowCount) return;
        } catch {
          // La conexión todavía no está lista o se cerró: se sigue esperando.
        }
      }
      await pausa(25);
    }
    logger.warn(`El adaptador de tiempo real no empezó a escuchar ${canal} en ${ms} ms`);
  }

  /**
   * Cierra el pool. El adaptador suelta su conexión al cerrar Socket.IO; si algo quedó sin soltar, se cierran las
   * conexiones a la fuerza después de una espera corta (si no, `pool.end()` no terminaría nunca).
   */
  async cerrar(): Promise<void> {
    const fin = this.pool.end().then(
      () => true,
      () => true,
    );
    const terminado = await Promise.race([fin, pausa(ESPERA_DE_CIERRE_MS).then(() => false)]);
    if (terminado) return;
    for (const cliente of [...this.clientes]) {
      cliente.removeAllListeners('end');
      await cliente.end().catch(() => undefined);
    }
  }
}
