import { Aviso, Esqueleto } from '@restaurante/ui';
import { useEffect, useState } from 'react';

interface Props {
  texto: string;
  /** Lo que oyen los lectores de pantalla en lugar del dibujo. */
  etiqueta: string;
}

type Dibujo = { estado: 'cargando' } | { estado: 'listo'; lado: number; ruta: string } | { estado: 'fallo' };

/**
 * Un QR siempre es oscuro sobre claro, también cuando llegue el tema nocturno: por eso estos dos colores son
 * fijos y no tokens. El oscuro es la tinta de la app (15:1 sobre blanco).
 */
const FONDO = '#ffffff';
const MODULOS = '#14222e';

/** Cuántos módulos en blanco rodean el código: los lectores lo necesitan para encontrarlo. */
const MARGEN_EN_MODULOS = 4;

/**
 * El QR como un solo trazo SVG (nítido a cualquier tamaño, sin imágenes ni red). La librería
 * (`qrcode-generator`, versión fija, unos 6 kB comprimidos) se descarga recién aquí, cuando una persona toca
 * "Vincular puente": no cuenta en el paquete inicial. Nivel de corrección M: aguanta una pantalla con brillo
 * bajo o un reflejo sin volver el código demasiado denso.
 */
export function CodigoQr({ texto, etiqueta }: Props) {
  const [dibujo, setDibujo] = useState<Dibujo>({ estado: 'cargando' });

  useEffect(() => {
    let vigente = true;
    setDibujo({ estado: 'cargando' });
    import('qrcode-generator')
      .then(({ default: qrcode }) => {
        if (!vigente) return;
        const qr = qrcode(0, 'M');
        qr.addData(texto);
        qr.make();
        const modulos = qr.getModuleCount();
        let ruta = '';
        for (let fila = 0; fila < modulos; fila++) {
          // Cada tramo oscuro de una fila es un solo rectángulo: el trazo queda corto.
          let columna = 0;
          while (columna < modulos) {
            if (!qr.isDark(fila, columna)) {
              columna++;
              continue;
            }
            const inicio = columna;
            while (columna < modulos && qr.isDark(fila, columna)) columna++;
            ruta += `M${inicio + MARGEN_EN_MODULOS} ${fila + MARGEN_EN_MODULOS}h${columna - inicio}v1h-${columna - inicio}z`;
          }
        }
        setDibujo({ estado: 'listo', lado: modulos + MARGEN_EN_MODULOS * 2, ruta });
      })
      .catch(() => {
        if (vigente) setDibujo({ estado: 'fallo' });
      });
    return () => {
      vigente = false;
    };
  }, [texto]);

  if (dibujo.estado === 'fallo') {
    return (
      <Aviso tipo="alerta" titulo="No pudimos dibujar el código">
        Copia el texto de abajo y pégalo en la app puente.
      </Aviso>
    );
  }
  if (dibujo.estado === 'cargando') {
    return (
      <>
        <Esqueleto className="qr__esqueleto" />
        <span role="status" className="ui-solo-lectores">
          Preparando el código
        </span>
      </>
    );
  }
  return (
    <svg
      className="qr__dibujo"
      viewBox={`0 0 ${dibujo.lado} ${dibujo.lado}`}
      role="img"
      aria-label={etiqueta}
      shapeRendering="crispEdges"
    >
      <rect width={dibujo.lado} height={dibujo.lado} fill={FONDO} />
      <path d={dibujo.ruta} fill={MODULOS} />
    </svg>
  );
}
