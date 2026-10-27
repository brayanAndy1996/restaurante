const PREFIJOS_VALIDOS = ['10', '15', '16', '17', '20'];
const FACTORES = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/**
 * Valida un RUC peruano: 11 dígitos, prefijo 10, 15, 16, 17 o 20 y dígito verificador correcto
 * (módulo 11 con los factores 5 4 3 2 7 6 5 4 3 2).
 */
export function validarRuc(ruc: string): boolean {
  if (typeof ruc !== 'string' || !/^\d{11}$/.test(ruc)) return false;
  if (!PREFIJOS_VALIDOS.includes(ruc.slice(0, 2))) return false;

  let suma = 0;
  for (let i = 0; i < FACTORES.length; i++) {
    suma += Number(ruc[i]) * (FACTORES[i] as number);
  }
  const resto = 11 - (suma % 11);
  const digito = resto >= 10 ? resto - 10 : resto;
  return digito === Number(ruc[10]);
}
