/**
 * Direcciones (slugs) de la carta web (historia 005, criterio 2; no es ruta crítica): las reglas de forma y la
 * propuesta a partir de un nombre.
 */

/** Direcciones que una empresa no puede usar porque son rutas o nombres de la plataforma (criterio 2). */
export const SLUGS_RESERVADOS = [
  'api',
  'app',
  'www',
  'publico',
  'carta',
  'cartas',
  'admin',
  'ayuda',
  'static',
  'robots',
  'sitemap',
  'favicon',
] as const;

export const LARGO_MINIMO_SLUG = 3;
export const LARGO_MAXIMO_SLUG = 40;

const FORMATO_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * `true` si el texto es una dirección válida: de 3 a 40 caracteres, `a-z`, `0-9` y guiones simples entre
 * grupos (`^[a-z0-9]+(-[a-z0-9]+)*$`), y fuera de `SLUGS_RESERVADOS`. No pasa a minúsculas: una dirección con
 * mayúsculas no es válida (la API pasa a minúsculas solo al buscar).
 */
export function esSlugValido(slug: string): boolean {
  if (typeof slug !== 'string') return false;
  if (slug.length < LARGO_MINIMO_SLUG || slug.length > LARGO_MAXIMO_SLUG) return false;
  if (!FORMATO_SLUG.test(slug)) return false;
  return !(SLUGS_RESERVADOS as readonly string[]).includes(slug);
}

/**
 * Propuesta de dirección a partir de un nombre: sin tildes, en minúsculas, con guiones entre palabras y de
 * hasta 40 caracteres ("Sabor Norteño" da `sabor-norteno`). Devuelve una dirección válida (`esSlugValido`) o el
 * texto vacío si el nombre no da ninguna (por ejemplo, un nombre sin letras ni números latinos o una dirección
 * reservada).
 */
export function propuestaDeSlug(nombre: string): string {
  if (typeof nombre !== 'string') return '';
  const base = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const recortada = base.slice(0, LARGO_MAXIMO_SLUG).replace(/-+$/g, '');
  return esSlugValido(recortada) ? recortada : '';
}
