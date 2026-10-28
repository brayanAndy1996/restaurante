import { Aviso, EtiquetaDeEstado, IconoPendiente } from '@restaurante/ui';

/** Etiqueta de un cambio que espera la red (criterio 78 de 003): dice el estado con palabras y con icono. */
export function EtiquetaPendiente() {
  return (
    <EtiquetaDeEstado tono="alerta" icono={IconoPendiente}>
      Pendiente de envío
    </EtiquetaDeEstado>
  );
}

/**
 * La etiqueta "Pendiente de envío" dentro de una región `status`, para que los lectores de pantalla la
 * anuncien cuando aparece. Sin envío pendiente no dibuja nada.
 */
export function PendienteDeEnvio({ pendiente }: { pendiente: boolean }) {
  return (
    <span role="status" className="pendiente-de-envio">
      {pendiente ? <EtiquetaPendiente /> : null}
    </span>
  );
}

/**
 * Aviso de un formulario con un cambio esperando la red: dice qué pasa y que lo escrito sigue ahí. Va con
 * el título "Pendiente de envío" para que sea la misma palabra en toda la app.
 */
export function AvisoPendiente({ pendiente }: { pendiente: boolean }) {
  if (!pendiente) return null;
  return (
    <Aviso tipo="alerta" titulo="Pendiente de envío" icono={IconoPendiente}>
      No hay conexión con el servidor. Tus cambios se enviarán solos al volver la red y no se
      duplicarán. Puedes seguir en esta pantalla.
    </Aviso>
  );
}
