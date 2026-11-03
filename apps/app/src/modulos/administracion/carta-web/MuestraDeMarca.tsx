import { EtiquetaDeEstado, IconoAlerta, IconoOk } from '@restaurante/ui';
import { useState } from 'react';
import type { MarcaEnLaCarta } from './carta-web';

interface Props {
  nombre: string;
  logoUrl: string | null;
  marca: MarcaEnLaCarta;
}

/**
 * Cómo se verá la marca en la carta: el encabezado con el logo y el nombre, y un botón de acción, ambos con el
 * color que de verdad se usará (el elegido, o el más cercano que deje leer las letras blancas). Los colores salen de
 * `colorDeMarcaAccesible` de `packages/dominio`; aquí solo se pintan. Va con su resumen en palabras: el color
 * nunca es la única señal.
 */
export function MuestraDeMarca({ nombre, logoUrl, marca }: Props) {
  const [logoRoto, setLogoRoto] = useState<string | null>(null);
  const estilo = { background: marca.fondo, color: marca.texto };
  return (
    <figure className="muestra" aria-label="Muestra de tu carta con este color">
      <div className="muestra__encabezado" style={estilo}>
        {logoUrl && logoUrl !== logoRoto ? (
          <img
            className="muestra__logo"
            src={logoUrl}
            alt=""
            decoding="async"
            onError={() => setLogoRoto(logoUrl)}
          />
        ) : null}
        <span className="muestra__nombre">{nombre.trim() || 'Tu restaurante'}</span>
      </div>
      <div className="muestra__cuerpo">
        <span className="muestra__boton" style={estilo}>
          Enviar al mozo
        </span>
        <span className="muestra__nota">
          {marca.seOscurecio ? (
            <EtiquetaDeEstado tono="alerta" icono={IconoAlerta}>
              Color ajustado
            </EtiquetaDeEstado>
          ) : (
            <EtiquetaDeEstado tono="ok" icono={IconoOk}>
              Se lee bien
            </EtiquetaDeEstado>
          )}
          <span className="texto-ayuda">
            Letras blancas sobre {marca.fondo}: contraste {marca.contrasteFinal}:1
          </span>
        </span>
      </div>
    </figure>
  );
}
