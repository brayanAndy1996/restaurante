import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

type Agente = ReturnType<typeof request>;
/** Una petición de supertest: se le puede encadenar `.set(...)`, `.send(...)` y `await`. */
export type PeticionPublica = ReturnType<Agente['get']>;

export interface OpcionesClientePublico {
  /** IP del cliente; por defecto una distinta por instancia (rango 198.18.0.0/15, el de pruebas de red). */
  ip?: string;
  /** Cabecera donde viaja la IP; por defecto la de `CABECERA_IP_CLIENTE` (o `cf-connecting-ip`). */
  cabeceraIp?: string;
  /** `Origin` que manda el navegador; por defecto ninguno. */
  origen?: string;
}

/** Nombre de la cabecera con la IP real del cliente en las pruebas (`fijarEntornoDePrueba` la fija). */
export const CABECERA_IP_DE_PRUEBA = 'cf-connecting-ip';

let siguienteIp = 0;

/** IP de pruebas distinta en cada llamada: 198.18.x.y. */
function ipNueva(): string {
  siguienteIp += 1;
  const bajo = (siguienteIp % 254) + 1;
  const alto = Math.floor(siguienteIp / 254) % 254;
  return `198.18.${alto}.${bajo}`;
}

/**
 * Cliente de las rutas públicas de la carta web y del modo mesa (historia 005): peticiones **sin sesión** (ni
 * `Authorization` ni `X-Equipo`) con una IP elegida en la cabecera de `CABECERA_IP_CLIENTE`, como las manda el
 * navegador de un cliente detrás de Cloudflare. Cada instancia tiene su IP, así que los límites por conexión de una
 * prueba no cuentan para otra; `conIp` da otro cliente con otra IP, y `sinIp` uno que no manda la cabecera (la API
 * usa entonces la IP de la conexión). Las peticiones son las de supertest: se puede encadenar `.set(...)` (por
 * ejemplo un `Authorization` que la ruta debe ignorar) y `.send(...)`.
 */
export class ClientePublico {
  readonly ip: string | null;
  private readonly cabeceraIp: string;
  private readonly origen: string | undefined;

  constructor(
    private readonly app: INestApplication,
    opciones: OpcionesClientePublico & { sinIp?: boolean } = {},
  ) {
    this.ip = opciones.sinIp === true ? null : (opciones.ip ?? ipNueva());
    this.cabeceraIp =
      opciones.cabeceraIp ?? process.env.CABECERA_IP_CLIENTE ?? CABECERA_IP_DE_PRUEBA;
    this.origen = opciones.origen;
  }

  /** Otro cliente de la misma aplicación con otra IP. */
  conIp(ip: string): ClientePublico {
    return new ClientePublico(this.app, {
      ip,
      cabeceraIp: this.cabeceraIp,
      ...(this.origen === undefined ? {} : { origen: this.origen }),
    });
  }

  /** Otro cliente que manda este `Origin` (el navegador de la carta web). */
  conOrigen(origen: string): ClientePublico {
    return new ClientePublico(this.app, {
      ...(this.ip === null ? { sinIp: true } : { ip: this.ip }),
      cabeceraIp: this.cabeceraIp,
      origen,
    });
  }

  /** Otro cliente que no manda la cabecera de la IP. */
  sinIp(): ClientePublico {
    return new ClientePublico(this.app, {
      sinIp: true,
      cabeceraIp: this.cabeceraIp,
      ...(this.origen === undefined ? {} : { origen: this.origen }),
    });
  }

  private con(peticion: PeticionPublica): PeticionPublica {
    if (this.ip !== null) peticion.set(this.cabeceraIp, this.ip);
    if (this.origen !== undefined) peticion.set('Origin', this.origen);
    return peticion;
  }

  private agente(): Agente {
    return request(this.app.getHttpServer());
  }

  get(ruta: string): PeticionPublica {
    return this.con(this.agente().get(ruta));
  }

  /** `POST` con un cuerpo JSON (o sin cuerpo si no se pasa). */
  post(ruta: string, cuerpo?: unknown): PeticionPublica {
    const peticion = this.con(this.agente().post(ruta) as PeticionPublica);
    return cuerpo === undefined ? peticion : peticion.send(cuerpo as object);
  }

  options(ruta: string): PeticionPublica {
    return this.con(this.agente().options(ruta));
  }
}
