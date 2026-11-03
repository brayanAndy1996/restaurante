import {
  Aviso,
  Boton,
  DialogoConfirmacion,
  Icono,
  IconoBasura,
  IconoCamara,
  IconoCargando,
  IconoImagen,
  IconoReintentar,
} from '@restaurante/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { nuevaClaveDeIdempotencia } from '../../../lib/api';
import { ErrorApi, mensajeDeError } from '../../../lib/errores';
import { ErrorDeFoto } from '../../../lib/imagen';
import { quitarLogoDeCartaWeb, subirLogoDeCartaWeb } from './carta-web';
import { prepararLogo } from './logo';

interface Props {
  nombre: string;
  /** Logo guardado (URL pública). */
  logoUrl: string | null;
  /** Sin la configuración guardada la API no acepta el logo (409): se pide guardar primero. */
  habilitado: boolean;
  /** El logo cambió en el servidor (`null` = se quitó). */
  onCambio: (logoUrl: string | null) => void;
}

const MENSAJES = {
  FOTO_INVALIDA:
    'El logo no sirve: usa una imagen JPEG, PNG o WebP de al menos 64 píxeles de lado. Elige otra.',
  CUERPO_DEMASIADO_GRANDE: 'El logo pesa demasiado. Elige uno más liviano.',
  TIPO_NO_SOPORTADO: 'Ese tipo de imagen no se admite. Elige una en JPEG, PNG o WebP.',
  CARTA_WEB_SIN_CONFIGURAR: 'Primero guarda el nombre y la dirección de tu carta.',
  PROHIBIDO: 'No tienes permiso para cambiar el logo.',
} as const;

/** Errores que no se arreglan reintentando con la misma imagen: hay que elegir otra. */
const SIN_REINTENTO = new Set([
  'FOTO_INVALIDA',
  'CUERPO_DEMASIADO_GRANDE',
  'TIPO_NO_SOPORTADO',
  'CARTA_WEB_SIN_CONFIGURAR',
  'PROHIBIDO',
]);

type Estado = 'reposo' | 'preparando' | 'subiendo' | 'error';

/**
 * Logo de la carta (criterio 74): subir, cambiar o quitar. Se prepara en el navegador (un logo que ya cumple se
 * sube tal cual), se muestra de inmediato y, si la red se corta, la imagen ya preparada queda a la espera de
 * "Reintentar" con la misma clave de idempotencia. Quitarlo pide confirmación.
 */
export function LogoDeCartaWeb({ nombre, logoUrl, habilitado, onCambio }: Props) {
  const idEntrada = useId();
  const entrada = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<Estado>('reposo');
  const [pendiente, setPendiente] = useState<{ blob: Blob; url: string } | null>(null);
  const [error, setError] = useState<string>();
  const [puedeReintentar, setPuedeReintentar] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [quitando, setQuitando] = useState(false);
  const [rota, setRota] = useState<string | null>(null);
  const clave = useRef<string | null>(null);
  const actual = useRef(pendiente);
  useEffect(() => {
    actual.current = pendiente;
  });
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
      clave.current ??= nuevaClaveDeIdempotencia();
      const respuesta = await subirLogoDeCartaWeb(blob, { idempotente: clave.current });
      clave.current = null;
      descartarPendiente();
      setEstado('reposo');
      onCambio(respuesta.logoUrl);
    } catch (e) {
      const sinReintento = e instanceof ErrorApi && SIN_REINTENTO.has(e.codigo);
      if (sinReintento) {
        descartarPendiente();
        clave.current = null;
      }
      setPuedeReintentar(!sinReintento);
      setError(
        e instanceof ErrorApi && (e.sinConexion || e.estado >= 500)
          ? 'No hay conexión con el servidor. Tu logo sigue aquí: toca Reintentar cuando vuelva la red.'
          : mensajeDeError(e, MENSAJES),
      );
      setEstado('error');
    }
  }

  async function elegir(archivo: File) {
    setError(undefined);
    setPuedeReintentar(false);
    setEstado('preparando');
    let blob: Blob;
    try {
      blob = await prepararLogo(archivo);
    } catch (e) {
      setError(
        e instanceof ErrorDeFoto ? e.message : 'No pudimos preparar este logo. Prueba con otro.',
      );
      setEstado('error');
      return;
    }
    descartarPendiente();
    clave.current = nuevaClaveDeIdempotencia();
    setPendiente({ blob, url: URL.createObjectURL(blob) });
    await subir(blob);
  }

  async function quitar() {
    setQuitando(true);
    try {
      await quitarLogoDeCartaWeb();
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

  const imagen = pendiente?.url ?? logoUrl;
  const verImagen = imagen !== null && imagen !== undefined && imagen !== rota;
  const ocupado = estado === 'preparando' || estado === 'subiendo';

  return (
    <div className="logo-carta">
      <div className="logo-carta__fila">
        <div className="logo-carta__marco" aria-live="polite">
          {verImagen ? (
            <img
              className="logo-carta__imagen"
              src={imagen}
              alt={`Logo de ${nombre || 'tu restaurante'}`}
              decoding="async"
              onError={() => setRota(imagen)}
            />
          ) : (
            <span className="logo-carta__vacio">
              <Icono icono={IconoImagen} tamano={32} />
              <span>Sin logo</span>
            </span>
          )}
        </div>
        <div className="logo-carta__texto">
          {ocupado ? (
            <p className="logo-carta__estado" role="status">
              <Icono icono={IconoCargando} tamano={20} girando />
              {estado === 'preparando' ? 'Preparando el logo…' : 'Subiendo el logo…'}
            </p>
          ) : (
            <p className="texto-ayuda">
              {habilitado
                ? 'Se ve junto al nombre en tu carta. Usa una imagen cuadrada o un logo con fondo transparente en PNG.'
                : 'Guarda primero el nombre y la dirección para poder subir tu logo.'}
            </p>
          )}
        </div>
      </div>
      {error ? (
        <Aviso tipo="error" titulo="No se guardó el logo">
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
        aria-label="Elegir el logo de la carta"
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          // Se vacía para poder elegir el mismo archivo otra vez (por ejemplo, después de un error).
          e.target.value = '';
          if (archivo) void elegir(archivo);
        }}
      />
      <div className="logo-carta__acciones">
        {estado === 'error' && puedeReintentar && pendiente ? (
          <Boton
            variante="principal"
            icono={IconoReintentar}
            onClick={() => void subir(pendiente.blob)}
          >
            Reintentar
          </Boton>
        ) : null}
        <Boton
          icono={IconoCamara}
          disabled={!habilitado || ocupado}
          onClick={() => entrada.current?.click()}
        >
          {logoUrl || pendiente ? 'Cambiar logo' : 'Subir logo'}
        </Boton>
        {logoUrl && estado !== 'subiendo' ? (
          <Boton
            variante="peligro"
            icono={IconoBasura}
            disabled={ocupado}
            onClick={() => setConfirmando(true)}
          >
            Quitar logo
          </Boton>
        ) : null}
      </div>
      <DialogoConfirmacion
        abierta={confirmando}
        titulo="¿Quitar el logo?"
        etiquetaConfirmar="Quitar logo"
        textoCargando="Quitando…"
        peligro
        cargando={quitando}
        onConfirmar={() => void quitar()}
        onCancelar={() => setConfirmando(false)}
      >
        <p>Tu carta se verá solo con el nombre. Podrás subir otro logo cuando quieras.</p>
      </DialogoConfirmacion>
    </div>
  );
}
