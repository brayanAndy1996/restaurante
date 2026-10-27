import { ErrorAplicacion } from '../../nucleo/errores/error-aplicacion';

/** Texto recortado; lanza 400 DATOS_INVALIDOS (indicando el campo) si queda vacío. */
export function textoObligatorio(campo: string, valor: unknown, nombre: string): string {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (texto === '') {
    throw new ErrorAplicacion(400, 'DATOS_INVALIDOS', `${nombre} es obligatorio`, [
      { campo, mensaje: `${nombre} no puede estar vacío` },
    ]);
  }
  return texto;
}

/** Valida y recorta `actor` y `motivo` de una operación de plataforma. */
export function validarAuditoria(entrada: { actor: unknown; motivo: unknown }): {
  actor: string;
  motivo: string;
} {
  return {
    actor: textoObligatorio('actor', entrada.actor, 'El actor'),
    motivo: textoObligatorio('motivo', entrada.motivo, 'El motivo'),
  };
}
