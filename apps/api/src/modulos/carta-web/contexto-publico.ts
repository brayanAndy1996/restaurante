import { Inject, Injectable } from '@nestjs/common';
import { CODIGO_MESA_REGEX } from '@restaurante/contratos';
import { esSlugValido } from '@restaurante/dominio';
import type { Sequelize } from 'sequelize';
import { CONEXION_API } from '../../nucleo/base-de-datos';
import {
  buscarEmpresaDeCarta,
  buscarEmpresaDeCodigoMesa,
} from '../../nucleo/base-de-datos/consultas-sin-empresa';
import { ContextoEmpresa } from '../../nucleo/contexto-empresa';
import { cartaNoDisponible } from './errores-carta-web';

/** El actor de toda escritura de una ruta pública (criterio 13): no hay persona, hay "la carta web". */
export const ACTOR_CARTA_WEB = { sistema: 'carta-web' } as const;

/**
 * Resolución pública de la empresa (historia 005, criterios 11 a 15; ruta crítica P1). Una ruta pública no trae
 * sesión: la empresa sale solo de la dirección o del código de la mesa, nunca de `Authorization` ni de
 * `x-empresa-id`. El flujo es siempre el mismo:
 *
 * 1. La forma del texto (el código con `CODIGO_MESA_REGEX`, la dirección con `esSlugValido`): si no cumple, 404 sin
 *    consultar la base.
 * 2. Fuera de toda transacción y de todo contexto, la búsqueda exacta de la empresa con su consulta fija
 *    (`buscarEmpresaDeCodigoMesa` o `buscarEmpresaDeCarta`). Sin coincidencia, 404 sin abrir ningún contexto.
 * 3. Una sola `ContextoEmpresa.ejecutar` con el actor de sistema `carta-web`: una transacción y un solo
 *    `fijar_contexto_empresa`. Todo lo demás se lee y se escribe bajo la RLS de esa empresa.
 *
 * Todos los 404 tienen el mismo cuerpo (`cartaNoDisponible`).
 */
@Injectable()
export class ContextoPublico {
  constructor(
    @Inject(CONEXION_API) private readonly conexion: Sequelize,
    @Inject(ContextoEmpresa) private readonly contexto: ContextoEmpresa,
  ) {}

  /** Corre `fn` en el contexto de la empresa de la mesa con ese código (criterio 13). */
  async porCodigoDeMesa<T>(codigo: string, fn: (empresaId: string) => Promise<T>): Promise<T> {
    if (typeof codigo !== 'string' || !CODIGO_MESA_REGEX.test(codigo)) throw cartaNoDisponible();
    const empresaId = await buscarEmpresaDeCodigoMesa(this.conexion, codigo);
    if (empresaId === null) throw cartaNoDisponible();
    return this.dentroDe(empresaId, fn);
  }

  /** Corre `fn` en el contexto de la empresa con esa dirección (que se pasa a minúsculas antes de buscar). */
  async porDireccion<T>(empresaSlug: string, fn: (empresaId: string) => Promise<T>): Promise<T> {
    const slug = direccionNormalizada(empresaSlug);
    if (slug === null) throw cartaNoDisponible();
    const empresaId = await buscarEmpresaDeCarta(this.conexion, slug);
    if (empresaId === null) throw cartaNoDisponible();
    return this.dentroDe(empresaId, fn);
  }

  private dentroDe<T>(empresaId: string, fn: (empresaId: string) => Promise<T>): Promise<T> {
    return this.contexto.ejecutar(empresaId, () => fn(empresaId), { actor: ACTOR_CARTA_WEB });
  }
}

/**
 * La dirección en minúsculas si tiene la forma de una dirección válida (y no es una reservada); si no, `null`. La API
 * pasa a minúsculas antes de buscar (criterio 12): `Sabor-Norteno` y `sabor-norteno` son la misma carta.
 */
export function direccionNormalizada(texto: string): string | null {
  if (typeof texto !== 'string') return null;
  // Solo las letras ASCII: `toLowerCase()` convertiría también caracteres como el signo Kelvin en una `k`.
  const minusculas = texto.replace(/[A-Z]/g, (letra) => letra.toLowerCase());
  return esSlugValido(minusculas) ? minusculas : null;
}
