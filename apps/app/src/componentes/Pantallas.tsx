import { Aviso, Boton, Cenefa, EsqueletoDeLista, IconoReintentar } from '@restaurante/ui';
import type { ErrorApi } from '../lib/errores';
import { mensajeDeError } from '../lib/errores';

/** Pantalla de carga completa: cenefa y esqueleto con la forma de una lista, nunca en blanco. */
export function PantallaDeCarga({ etiqueta = 'Cargando' }: { etiqueta?: string }) {
  return (
    <div className="entrada">
      <Cenefa estado="normal" />
      <div className="entrada__marca">Restaurante</div>
      <div style={{ paddingTop: 'var(--espacio-lg)' }}>
        <EsqueletoDeLista filas={4} etiqueta={etiqueta} />
      </div>
    </div>
  );
}

/** No se pudo leer la sesión al abrir (por ejemplo, sin conexión): se dice y se ofrece reintentar. */
export function ErrorDeArranque({
  error,
  onReintentar,
  onSalir,
}: {
  error: ErrorApi;
  onReintentar: () => void;
  onSalir: () => void;
}) {
  return (
    <div className="entrada">
      <Cenefa estado={error.sinConexion ? 'sin-conexion' : 'normal'} />
      <div className="entrada__marca">Restaurante</div>
      <div className="entrada__cuerpo">
        <Aviso tipo="error" titulo="No pudimos abrir tu sesión">
          {mensajeDeError(error)}
        </Aviso>
        <Boton variante="principal" bloque icono={IconoReintentar} onClick={onReintentar}>
          Reintentar
        </Boton>
        <Boton bloque onClick={onSalir}>
          Ingresar de nuevo
        </Boton>
      </div>
    </div>
  );
}
