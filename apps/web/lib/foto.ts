/**
 * La foto de un producto como la sirve el optimizador de imágenes de Next, a los mismos tamaños que usa la lista de
 * la carta (96 px y 192 px): así la hoja del producto reutiliza lo que el navegador ya bajó y no pide otra foto.
 * `next/image` arma esta misma dirección en el servidor; aquí se escribe a mano porque la hoja es de cliente y
 * `next/image` pesaría de más en el modo mesa.
 */
export function srcSetDeFoto(fotoUrl: string): { src: string; srcSet: string } {
  const url = (ancho: number) => `/_next/image?url=${encodeURIComponent(fotoUrl)}&w=${ancho}&q=75`;
  return { src: url(192), srcSet: `${url(96)} 1x, ${url(192)} 2x` };
}
