import { useId, useRef, useState } from 'react';
import { Boton } from './Boton';
import { Aviso } from './Aviso';
import {
  Icono,
  IconoBasura,
  IconoCamara,
  IconoCargando,
  IconoImagen,
  IconoReintentar,
} from './iconos';
import { clases } from './utilidades';

export type EstadoDeFoto = 'reposo' | 'reduciendo' | 'subiendo' | 'error';

interface PropsSelectorDeFoto {
  /** Nombre del producto: va en la descripción de la imagen y en los botones. */
  nombre: string;
  /** Foto que ya tiene el producto (URL pública). */
  url: string | null;
  /** Vista previa de la foto elegida que todavía no se guarda; manda sobre `url`. */
  vistaPrevia?: string | null;
  estado: EstadoDeFoto;
  /** Qué falló y cómo seguir ("No se pudo subir la foto. Tu foto sigue aquí"). */
  error?: string | undefined;
  /** Texto del detalle mientras trabaja ("230 KB"). */
  detalle?: string | undefined;
  onElegir: (archivo: File) => void;
  /** Reintenta lo que falló sin volver a elegir la foto. */
  onReintentar?: () => void;
  /** Pide quitar la foto (la pantalla confirma). Sin él, no se ofrece. */
  onQuitar?: () => void;
}

/**
 * Foto de un producto: vista previa en 4:3, "Tomar o elegir foto" (el sistema ofrece la cámara o la
 * galería), el estado del trabajo con palabras y, si falla, "Reintentar" sin perder la imagen.
 * Solo presenta: reducir la imagen y subirla es de quien lo usa.
 */
export function SelectorDeFoto({
  nombre,
  url,
  vistaPrevia,
  estado,
  error,
  detalle,
  onElegir,
  onReintentar,
  onQuitar,
}: PropsSelectorDeFoto) {
  const idEntrada = useId();
  const entrada = useRef<HTMLInputElement>(null);
  const [imagenRota, setImagenRota] = useState<string | null>(null);
  const imagen = vistaPrevia ?? url;
  const verImagen = imagen !== null && imagen !== undefined && imagen !== imagenRota;
  const ocupado = estado === 'reduciendo' || estado === 'subiendo';
  return (
    <div className="ui-foto">
      <div className={clases('ui-foto__marco', !verImagen && 'ui-foto__marco--vacio')}>
        {verImagen ? (
          <img
            className="ui-foto__imagen"
            src={imagen}
            alt={`Foto de ${nombre}`}
            decoding="async"
            onError={() => setImagenRota(imagen)}
          />
        ) : (
          <span className="ui-foto__vacia">
            <Icono icono={IconoImagen} tamano={32} />
            <span>Sin foto</span>
          </span>
        )}
        {ocupado ? (
          <span className="ui-foto__estado" role="status">
            <Icono icono={IconoCargando} tamano={20} girando />
            {estado === 'reduciendo' ? 'Preparando la foto…' : 'Subiendo la foto…'}
            {detalle ? <span className="ui-foto__detalle"> {detalle}</span> : null}
          </span>
        ) : null}
      </div>
      {error ? (
        <Aviso tipo="error" titulo="No se guardó la foto">
          {error}
        </Aviso>
      ) : null}
      <input
        ref={entrada}
        id={idEntrada}
        className="ui-solo-lectores"
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        aria-label={`Elegir foto de ${nombre}`}
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          // Se vacía para poder elegir la misma foto otra vez (por ejemplo, después de un error).
          e.target.value = '';
          if (archivo) onElegir(archivo);
        }}
      />
      <div className="ui-foto__acciones">
        {estado === 'error' && onReintentar ? (
          <Boton variante="principal" icono={IconoReintentar} onClick={onReintentar}>
            Reintentar
          </Boton>
        ) : null}
        <Boton icono={IconoCamara} disabled={ocupado} onClick={() => entrada.current?.click()}>
          {url || vistaPrevia ? 'Cambiar foto' : 'Tomar o elegir foto'}
        </Boton>
        {url && onQuitar && estado !== 'subiendo' ? (
          <Boton variante="peligro" icono={IconoBasura} disabled={ocupado} onClick={onQuitar}>
            Quitar foto
          </Boton>
        ) : null}
      </div>
    </div>
  );
}
