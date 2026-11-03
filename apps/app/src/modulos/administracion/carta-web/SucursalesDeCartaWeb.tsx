import type { CartaWebRespuesta } from '@restaurante/contratos';
import {
  Boton,
  CampoTexto,
  EtiquetaDeEstado,
  IconoCopiar,
  IconoOk,
  Interruptor,
  copiarTexto,
} from '@restaurante/ui';
import { useEffect, useRef, useState } from 'react';
import {
  direccionEscrita,
  propuestaDeDireccion,
  sinProtocolo,
  vistaDeLaDireccion,
  type BorradorDeSucursal,
} from './carta-web';

interface Props {
  carta: CartaWebRespuesta;
  /** Lo que se está escribiendo, en el mismo orden que `carta.sucursales`. */
  borradores: readonly BorradorDeSucursal[];
  errores: Record<string, string>;
  /** Dirección de la empresa tal como se está escribiendo (el enlace de la sucursal cuelga de ella). */
  direccionDeLaEmpresa: string;
  sitio: string | null;
  onCambio: (sucursalId: string, parcial: Partial<BorradorDeSucursal>) => void;
}

/** Una sucursal: su dirección, si está publicada y su enlace para copiar (criterio 74). */
export function SucursalesDeCartaWeb({
  carta,
  borradores,
  errores,
  direccionDeLaEmpresa,
  sitio,
  onCambio,
}: Props) {
  return (
    <ul className="carta-web__sucursales" aria-label="Sucursales">
      {borradores.map((borrador) => {
        const guardada = carta.sucursales.find((s) => s.sucursalId === borrador.sucursalId);
        return (
          <li key={borrador.sucursalId} className="carta-web__sucursal">
            <SucursalDeCartaWeb
              borrador={borrador}
              {...(guardada ? { guardada } : {})}
              error={errores[borrador.sucursalId]}
              direccionDeLaEmpresa={direccionDeLaEmpresa}
              sitio={sitio}
              onCambio={(parcial) => onCambio(borrador.sucursalId, parcial)}
            />
          </li>
        );
      })}
    </ul>
  );
}

interface PropsSucursal {
  borrador: BorradorDeSucursal;
  guardada?: CartaWebRespuesta['sucursales'][number];
  error: string | undefined;
  direccionDeLaEmpresa: string;
  sitio: string | null;
  onCambio: (parcial: Partial<BorradorDeSucursal>) => void;
}

function SucursalDeCartaWeb({
  borrador,
  guardada,
  error,
  direccionDeLaEmpresa,
  sitio,
  onCambio,
}: PropsSucursal) {
  const [copiado, setCopiado] = useState<'no' | 'si' | 'fallo'>('no');
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(temporizador.current), []);

  const propuesta = propuestaDeDireccion(borrador.nombre);
  const slug = borrador.slug.trim();
  const enlace = guardada?.url ?? null;
  const publicadaGuardada = guardada?.publicada ?? false;

  async function copiar() {
    if (!enlace) return;
    const ok = await copiarTexto(enlace);
    setCopiado(ok ? 'si' : 'fallo');
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setCopiado('no'), 4000);
  }

  return (
    <div className="carta-web__grupo">
      <div className="carta-web__sucursal-cabecera">
        <h4 className="carta-web__sucursal-nombre">{borrador.nombre}</h4>
        {publicadaGuardada ? (
          <EtiquetaDeEstado tono="ok" icono={IconoOk}>
            Publicada
          </EtiquetaDeEstado>
        ) : (
          <EtiquetaDeEstado tono="neutro">Sin publicar</EtiquetaDeEstado>
        )}
      </div>
      <CampoTexto
        etiqueta={`Dirección de ${borrador.nombre}`}
        value={borrador.slug}
        onChange={(e) => onCambio({ slug: direccionEscrita(e.target.value) })}
        error={error}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={40}
        ayuda={
          <>
            Se verá en{' '}
            <b className="carta-web__vista">
              {vistaDeLaDireccion(sitio, direccionDeLaEmpresa, slug === '' ? '…' : slug)}
            </b>
          </>
        }
      />
      {slug === '' && propuesta !== '' ? (
        <div>
          <Boton variante="texto" onClick={() => onCambio({ slug: propuesta })}>
            Usar «{propuesta}»
          </Boton>
        </div>
      ) : null}
      <Interruptor
        etiqueta="Publicada"
        nombreAccesible={`Publicada: ${borrador.nombre}`}
        marcado={borrador.publicada}
        onCambio={(publicada) => onCambio({ publicada })}
        ayuda="Si no está publicada, la carta y los QR de esta sucursal muestran «La carta no está disponible»."
      />
      <div className="carta-web__enlace">
        <Boton
          icono={copiado === 'si' ? IconoOk : IconoCopiar}
          disabled={!enlace}
          onClick={() => void copiar()}
          aria-label={`Copiar enlace de ${borrador.nombre}`}
        >
          {copiado === 'si' ? 'Enlace copiado' : 'Copiar enlace'}
        </Boton>
        <p className="texto-ayuda" role="status">
          {copiado === 'fallo'
            ? `No pudimos copiarlo. Cópialo a mano: ${enlace ? sinProtocolo(enlace) : ''}`
            : !guardada?.slug
              ? 'Guarda la dirección para tener el enlace.'
              : !enlace
                ? 'El enlace aún no está disponible. Avisa a soporte.'
                : !publicadaGuardada
                  ? 'Todavía no está publicada: quien abra el enlace verá «La carta no está disponible».'
                  : ''}
        </p>
      </div>
    </div>
  );
}
