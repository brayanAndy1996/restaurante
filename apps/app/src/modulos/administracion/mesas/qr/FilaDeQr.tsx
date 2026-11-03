import type { QrMesaDeLista } from '@restaurante/contratos';
import { Boton, EtiquetaDeEstado, Icono, IconoAlerta, IconoQr } from '@restaurante/ui';
import { fechaDeLima } from '../../../../lib/formato';
import { CodigoQr } from '../../impresion/CodigoQr';
import { nombreDeMesa, tieneCodigo } from './qr';

interface Props {
  mesa: QrMesaDeLista;
  /** Nombre de la sucursal: va solo en la tarjeta impresa. */
  sucursal: string;
  /** Se cambió el QR en esta visita: el impreso ya no sirve. */
  nuevo: boolean;
  onCambiar: (mesa: QrMesaDeLista) => void;
  onTerminarDibujo: (mesa: QrMesaDeLista, dibujado: boolean) => void;
}

/**
 * Una mesa de la hoja de QR. En pantalla es una fila con su QR pequeño y "Cambiar QR"; al imprimir (`@media
 * print`, ver `qr.css`) la misma fila se vuelve una tarjeta de 9 x 9 cm con el nombre de la sucursal, "Mesa 12"
 * grande, el QR de 5 cm y "Escanea para ver la carta y llamar al mozo". Los textos que solo van en uno de los dos
 * medios llevan la clase `qr-pantalla` o `qr-impreso`.
 */
export function FilaDeQr({ mesa, sucursal, nuevo, onCambiar, onTerminarDibujo }: Props) {
  const nombre = nombreDeMesa(mesa.nombre);
  const conCodigo = tieneCodigo(mesa);
  return (
    <li className={`qr-mesa${conCodigo ? '' : ' qr-mesa--sin-codigo'}`}>
      <p className="qr-impreso qr-mesa__sucursal">{sucursal}</p>
      <div className="qr-mesa__codigo">
        {conCodigo ? (
          <CodigoQr
            texto={mesa.url}
            etiqueta={`Código QR de la ${nombre.toLocaleLowerCase('es-PE')}`}
            margen={1}
            textoDeFallo="Recarga la pantalla para volver a dibujarlo."
            alTerminar={(dibujado) => onTerminarDibujo(mesa, dibujado)}
          />
        ) : (
          <span className="qr-mesa__vacio" aria-hidden="true">
            <Icono icono={IconoQr} tamano={24} />
          </span>
        )}
      </div>
      <div className="qr-mesa__texto">
        <b className="qr-mesa__nombre">{nombre}</b>
        <span className="qr-pantalla qr-mesa__estado">
          {!conCodigo ? (
            <EtiquetaDeEstado tono="alerta" icono={IconoAlerta}>
              Sin QR
            </EtiquetaDeEstado>
          ) : nuevo ? (
            <EtiquetaDeEstado tono="info" icono={IconoQr}>
              QR nuevo: imprímelo
            </EtiquetaDeEstado>
          ) : mesa.generadoEn ? (
            <span className="texto-ayuda">QR creado el {fechaDeLima(mesa.generadoEn)}</span>
          ) : null}
        </span>
      </div>
      <p className="qr-impreso qr-mesa__escanea">Escanea para ver la carta y llamar al mozo</p>
      {conCodigo ? (
        <Boton
          className="qr-pantalla"
          onClick={() => onCambiar(mesa)}
          aria-label={`Cambiar QR de la ${nombre.toLocaleLowerCase('es-PE')}`}
        >
          Cambiar QR
        </Boton>
      ) : null}
    </li>
  );
}
