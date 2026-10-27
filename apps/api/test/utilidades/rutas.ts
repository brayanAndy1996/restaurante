import type { INestApplication, Type } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';

/** Una ruta que Express tiene registrada (método en mayúsculas y ruta con `:parametros`). */
export interface RutaRegistrada {
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'ALL';
  ruta: string;
}

/**
 * Todas las rutas que la aplicación tiene registradas, tal como las ve Express: lo que de verdad
 * responde, incluidas las de los `controladoresExtra`. No es una lista fija: si se agrega un
 * controlador, aparece sola.
 */
export function rutasRegistradas(app: INestApplication): RutaRegistrada[] {
  const instancia = app.getHttpAdapter().getInstance() as {
    router?: { stack: PilaExpress[] };
    _router?: { stack: PilaExpress[] };
  };
  const pila = (instancia.router ?? instancia._router)?.stack ?? [];
  const rutas: RutaRegistrada[] = [];
  for (const capa of pila) {
    if (!capa.route) continue;
    for (const [metodo, activo] of Object.entries(capa.route.methods)) {
      if (activo) {
        rutas.push({
          metodo: metodo.toUpperCase() as RutaRegistrada['metodo'],
          ruta: capa.route.path,
        });
      }
    }
  }
  return rutas;
}

interface PilaExpress {
  route?: { path: string; methods: Record<string, boolean> };
}

const NOMBRES_DE_METODO: Record<number, RutaRegistrada['metodo']> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
};

/** Una ruta con el controlador y el método que la atienden, para leer sus metadatos con `Reflect`. */
export interface RutaDeNest extends RutaRegistrada {
  controlador: Type;
  /** Nombre del método del controlador. */
  manejador: string;
}

function unir(base: string, ruta: string): string {
  const partes = [base, ruta].map((p) => p.replace(/^\/+|\/+$/g, '')).filter((p) => p !== '');
  return '/' + partes.join('/');
}

/**
 * Las rutas de todos los controladores de los módulos de la aplicación, con su clase y el nombre del
 * método. Sirve para leer los metadatos de los decoradores:
 * `Reflect.getMetadata(PUBLICA, controlador.prototype[manejador])` (y, para los de clase,
 * `Reflect.getMetadata(SOLO_ADMINISTRADOR, controlador)`).
 */
export function rutasDeNest(app: INestApplication): RutaDeNest[] {
  const modulos = app.get(ModulesContainer);
  const rutas: RutaDeNest[] = [];
  const vistos = new Set<Type>();
  for (const modulo of modulos.values()) {
    for (const envoltorio of modulo.controllers.values()) {
      const controlador = envoltorio.metatype as Type | null;
      if (!controlador || vistos.has(controlador)) continue;
      vistos.add(controlador);
      const base =
        (Reflect.getMetadata(PATH_METADATA, controlador) as string | string[] | undefined) ?? '';
      const prefijo = Array.isArray(base) ? (base[0] ?? '') : base;
      for (const nombre of Object.getOwnPropertyNames(controlador.prototype)) {
        const manejador = (controlador.prototype as Record<string, unknown>)[nombre];
        if (typeof manejador !== 'function') continue;
        const metodo = Reflect.getMetadata(METHOD_METADATA, manejador) as number | undefined;
        if (metodo === undefined) continue;
        const rutaMetodo =
          (Reflect.getMetadata(PATH_METADATA, manejador) as string | string[] | undefined) ?? '';
        const sufijo = Array.isArray(rutaMetodo) ? (rutaMetodo[0] ?? '') : rutaMetodo;
        rutas.push({
          metodo: NOMBRES_DE_METODO[metodo] ?? 'ALL',
          ruta: unir(prefijo, sufijo),
          controlador,
          manejador: nombre,
        });
      }
    }
  }
  return rutas;
}
