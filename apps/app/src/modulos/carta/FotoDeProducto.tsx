import { DialogoConfirmacion, SelectorDeFoto, type EstadoDeFoto } from '@restaurante/ui';
import { useEffect, useRef, useState } from 'react';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { ErrorDeFoto, reducirFoto } from '../../lib/imagen';
import { quitarFotoDeProducto, subirFotoDeProducto } from './carta';

interface Props {
  productoId: string;
  nombre: string;
  /** Foto guardada del producto. */
  fotoUrl: string | null;
  /** La foto cambió en el servidor (`null` = se quitó). */
  onCambio: (fotoUrl: string | null) => void;
}

const MENSAJES = {
  FOTO_INVALIDA:
    'La foto no sirve: usa una en JPEG, PNG o WebP, de al menos 200 píxeles de lado. Elige otra.',
  CUERPO_DEMASIADO_GRANDE: 'La foto pesa demasiado. Elige otra más liviana.',
  TIPO_NO_SOPORTADO: 'Ese tipo de foto no se admite. Elige una en JPEG, PNG o WebP.',
  PROHIBIDO: 'No tienes permiso para cambiar la foto de este producto.',
  NO_ENCONTRADO: 'Este producto ya no existe. Vuelve a la carta.',
} as const;

/** Errores que no se arreglan reintentando con la misma imagen: hay que elegir otra. */
const SIN_REINTENTO = new Set(['FOTO_INVALIDA', 'CUERPO_DEMASIADO_GRANDE', 'TIPO_NO_SOPORTADO']);

function kb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Foto del producto (criterio 74): reduce la imagen en el navegador (1200 px, JPEG), muestra la vista
 * previa, sube y, si la red se corta, conserva la imagen ya reducida y ofrece reintentar sin volver a
 * elegirla. Quitarla pide confirmación.
 */
export function FotoDeProducto({ productoId, nombre, fotoUrl, onCambio }: Props) {
  const [estado, setEstado] = useState<EstadoDeFoto>('reposo');
  const [pendiente, setPendiente] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string>();
  const [puedeReintentar, setPuedeReintentar] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [quitando, setQuitando] = useState(false);
  const actual = useRef(pendiente);
  useEffect(() => {
    actual.current = pendiente;
  });

  // La vista previa es una URL del navegador: se libera al reemplazarla y al salir.
  useEffect(
    () => () => {
      if (actual.current) URL.revokeObjectURL(actual.current.url);
    },
    [],
  );

  function descartarPendiente() {
    if (actual.current) URL.revokeObjectURL(actual.current.url);
    setPendiente(null);
  }

  async function subir(blob: Blob) {
    setEstado('subiendo');
    setError(undefined);
    try {
      const respuesta = await subirFotoDeProducto(productoId, blob);
      descartarPendiente();
      setEstado('reposo');
      onCambio(respuesta.fotoUrl);
    } catch (e) {
      const sinReintento = e instanceof ErrorApi && SIN_REINTENTO.has(e.codigo);
      if (sinReintento) descartarPendiente();
      setPuedeReintentar(!sinReintento && e instanceof ErrorApi && e.codigo !== 'PROHIBIDO');
      setError(
        e instanceof ErrorApi && (e.sinConexion || e.estado >= 500)
          ? 'No hay conexión con el servidor. Tu foto sigue aquí: toca Reintentar cuando vuelva la red.'
          : mensajeDeError(e, MENSAJES),
      );
      setEstado('error');
    }
  }

  async function elegir(archivo: File) {
    setError(undefined);
    setPuedeReintentar(false);
    setEstado('reduciendo');
    let blob: Blob;
    try {
      blob = await reducirFoto(archivo);
    } catch (e) {
      setError(
        e instanceof ErrorDeFoto ? e.message : 'No pudimos preparar esta foto. Prueba con otra.',
      );
      setEstado('error');
      return;
    }
    descartarPendiente();
    setPendiente({ blob, url: URL.createObjectURL(blob) });
    await subir(blob);
  }

  async function quitar() {
    setQuitando(true);
    try {
      await quitarFotoDeProducto(productoId);
      setConfirmando(false);
      setError(undefined);
      setEstado('reposo');
      onCambio(null);
    } catch (e) {
      setConfirmando(false);
      setError(mensajeDeError(e, MENSAJES));
      setPuedeReintentar(false);
      setEstado('error');
    } finally {
      setQuitando(false);
    }
  }

  return (
    <>
      <SelectorDeFoto
        nombre={nombre}
        url={fotoUrl}
        vistaPrevia={pendiente?.url ?? null}
        estado={estado}
        error={error}
        detalle={pendiente ? kb(pendiente.blob.size) : undefined}
        onElegir={(archivo) => void elegir(archivo)}
        {...(puedeReintentar && pendiente
          ? { onReintentar: () => void subir(pendiente.blob) }
          : {})}
        {...(fotoUrl ? { onQuitar: () => setConfirmando(true) } : {})}
      />
      <DialogoConfirmacion
        abierta={confirmando}
        titulo="¿Quitar la foto?"
        etiquetaConfirmar="Quitar foto"
        textoCargando="Quitando…"
        peligro
        cargando={quitando}
        onConfirmar={() => void quitar()}
        onCancelar={() => setConfirmando(false)}
      >
        <p>«{nombre}» se verá sin foto en la carta. Podrás subir otra cuando quieras.</p>
      </DialogoConfirmacion>
    </>
  );
}
