import { NextResponse, type NextRequest } from 'next/server';
import { rutaEnMinusculas } from '@/lib/rutas';

/**
 * Next 16 llama `proxy` a lo que antes era `middleware`. Una dirección con mayúsculas redirige con 308 a la de
 * minúsculas (criterio 79), conservando la consulta. No toca los archivos de Next ni los que tienen extensión.
 */
export function proxy(solicitud: NextRequest) {
  const { pathname } = solicitud.nextUrl;
  const destino = rutaEnMinusculas(pathname);
  if (destino === pathname) return NextResponse.next();
  const url = solicitud.nextUrl.clone();
  url.pathname = destino;
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: ['/((?!_next/|.*\\..*).*)'],
};
