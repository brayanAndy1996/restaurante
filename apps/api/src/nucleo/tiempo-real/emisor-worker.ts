import { ESPACIO_PUENTE } from '@restaurante/contratos';
import { Logger } from '@nestjs/common';
import type { EventoPublicable, PublicadorEventos } from '../eventos';
import { verificarRolDePool } from '../base-de-datos/verificar-roles';
import { PoolDelAdaptador } from './adaptador-postgres';
import { ESPACIO_PWA, salaDeSocketIo } from './salas';

/** Peso a partir del cual un evento es un error de programación (criterio 69): el emisor ni lo intenta. */
const PESO_MAXIMO_DE_EVENTO = 4096;

/** `MessageType.BROADCAST` de `socket.io-adapter`: lo que el adaptador de PostgreSQL entiende como «emitir a una sala». */
const MENSAJE_BROADCAST = 3;
/** `PacketType.EVENT` de `socket.io-parser`. */
const PAQUETE_EVENTO = 2;
/**
 * El `uid` con el que un emisor externo se presenta al adaptador (`EMITTER_UID` de `socket.io-adapter`): así no cuenta
 * como un servidor más del clúster en sus latidos.
 */
const UID_DEL_EMISOR = 'emitter';

/**
 * El publicador de eventos del worker (historia 006, criterio 172): el worker no sirve Socket.IO, así que publica por el
 * mismo canal de PostgreSQL que escucha el adaptador de las instancias de la API (`socket.io#<espacio>`, con
 * `pg_notify`), con el rol `restaurante_tiempo_real` (`DATABASE_TIEMPO_REAL_URL`), que no ve ninguna tabla de `public`.
 * Las salas son las de `salaDeSocketIo` (siempre llevan la empresa), así que un evento nunca llega a otra empresa. Solo
 * ids, menos de 4 KB: nunca necesita la tabla auxiliar de los mensajes grandes.
 *
 * El mensaje tiene el formato del clúster de `socket.io-adapter` (`uid`, `nsp`, `type` y `data`): lo comprueba
 * `test/tiempo-real/emisor-worker.spec.ts` contra el adaptador instalado. (`@socket.io/postgres-emitter` 0.1.1 no sirve:
 * no manda el `nsp` que el adaptador 0.5.0 exige y sus mensajes se descartan.)
 *
 * Publicar nunca lanza: el evento ya describe algo confirmado en la base y, si el canal falla, la PWA se pone al día con
 * su siguiente consulta; el fallo queda en el registro.
 */
export class EmisorDelWorker implements PublicadorEventos {
  private readonly logger = new Logger(EmisorDelWorker.name);
  private readonly adaptador: PoolDelAdaptador;

  constructor(url: string) {
    this.adaptador = new PoolDelAdaptador(url);
  }

  /** Comprueba que el rol del emisor no pueda saltarse la RLS (como el adaptador de la API, criterio 70). */
  async verificar(): Promise<void> {
    await verificarRolDePool(this.adaptador.pool, 'DATABASE_TIEMPO_REAL_URL');
  }

  async publicar(evento: EventoPublicable): Promise<void> {
    const sala = salaDeSocketIo(evento);
    if (sala === null) {
      this.logger.warn(
        `Se descartó el evento "${evento.nombre}": su empresa o su sala no son válidas`,
      );
      return;
    }
    try {
      const peso = Buffer.byteLength(JSON.stringify(evento.datos));
      if (peso >= PESO_MAXIMO_DE_EVENTO) {
        this.logger.warn(
          `Se descartó el evento "${evento.nombre}": pesa ${peso} bytes (el límite es ${PESO_MAXIMO_DE_EVENTO})`,
        );
        return;
      }
      const espacio = evento.sala.tipo === 'puente' ? ESPACIO_PUENTE : ESPACIO_PWA;
      const mensaje = {
        uid: UID_DEL_EMISOR,
        nsp: espacio,
        type: MENSAJE_BROADCAST,
        data: {
          packet: { type: PAQUETE_EVENTO, data: [evento.nombre, evento.datos], nsp: espacio },
          opts: { rooms: [sala], except: [], flags: {} },
        },
      };
      await this.adaptador.pool.query('SELECT pg_notify($1, $2)', [
        `socket.io#${espacio}`,
        JSON.stringify(mensaje),
      ]);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          evento: 'tiempo_real.emision_fallida',
          nombre: evento.nombre,
          error: error instanceof Error ? error.name : 'error desconocido',
        }),
      );
    }
  }

  /** Cierra el pool de la conexión del emisor. */
  async cerrar(): Promise<void> {
    await this.adaptador.cerrar();
  }
}
