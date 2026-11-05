import { Aviso, Boton, CampoTexto, Segmentos, type OpcionDeSegmento } from '@restaurante/ui';
import { useState } from 'react';
import {
  NOMBRE_DE_DOCUMENTO,
  boletaExigeCliente,
  type ClienteEscrito,
  type ErroresDeCliente,
  type FormatoDeCobro,
  type TipoDeDocumento,
} from './cobro';

type Tipo = 'BOLETA' | 'FACTURA';

const OPCIONES_DE_TIPO: readonly OpcionDeSegmento<Tipo>[] = [
  { valor: 'BOLETA', etiqueta: 'Boleta' },
  { valor: 'FACTURA', etiqueta: 'Factura' },
];
const OPCIONES_DE_FORMATO: readonly OpcionDeSegmento<FormatoDeCobro>[] = [
  { valor: 'DETALLADO', etiqueta: 'Detallado' },
  { valor: 'CONSUMO', etiqueta: 'Por consumo' },
];
const DOCUMENTOS_DE_BOLETA: readonly OpcionDeSegmento<TipoDeDocumento>[] = [
  { valor: 'DNI', etiqueta: NOMBRE_DE_DOCUMENTO.DNI },
  { valor: 'CE', etiqueta: NOMBRE_DE_DOCUMENTO.CE },
  { valor: 'PASAPORTE', etiqueta: NOMBRE_DE_DOCUMENTO.PASAPORTE },
];

interface Props {
  /** Los tipos que el régimen del emisor permite (un Nuevo RUS solo emite boletas). */
  permitidos: readonly Tipo[];
  tipo: Tipo;
  onTipo: (tipo: Tipo) => void;
  formato: FormatoDeCobro;
  onFormato: (formato: FormatoDeCobro) => void;
  /** En partes iguales el comprobante solo puede ser por consumo (criterio 51). */
  soloConsumo: boolean;
  /** El total de la parte, para el aviso de las boletas de más de S/ 700. */
  total: string;
  cliente: ClienteEscrito;
  onCliente: (cliente: ClienteEscrito) => void;
  /** Lo que falta o está mal del cliente; solo se muestra cuando la persona ya intentó cobrar. */
  errores: ErroresDeCliente | null;
}

/** Boleta o factura, detallado o por consumo, y el cliente cuando hace falta (criterios 51 y 111). */
export function ComprobantePanel({
  permitidos,
  tipo,
  onTipo,
  formato,
  onFormato,
  soloConsumo,
  total,
  cliente,
  onCliente,
  errores,
}: Props) {
  const [conCliente, setConCliente] = useState(false);
  const exigido = tipo === 'FACTURA' || boletaExigeCliente(total);
  const visible = exigido || conCliente || cliente.numero !== '' || cliente.nombre !== '';
  const documento: TipoDeDocumento = tipo === 'FACTURA' ? 'RUC' : cliente.tipoDocumento;
  const poner = (cambio: Partial<ClienteEscrito>) => onCliente({ ...cliente, ...cambio });

  return (
    <section className="cobro__bloque cobro__bloque--junta" aria-labelledby="cobro-comprobante">
      <h2 id="cobro-comprobante">Comprobante</h2>
      {permitidos.length > 1 ? (
        <Segmentos
          etiqueta="Tipo de comprobante"
          opciones={OPCIONES_DE_TIPO.filter((o) => permitidos.includes(o.valor))}
          valor={tipo}
          onCambio={onTipo}
        />
      ) : (
        <p className="texto-ayuda">Esta empresa solo emite boletas, por su régimen tributario.</p>
      )}
      {soloConsumo ? (
        <p className="texto-ayuda">
          En partes iguales el comprobante sale por consumo: una línea con el monto de la parte.
        </p>
      ) : (
        <Segmentos
          etiqueta="Formato del comprobante"
          opciones={OPCIONES_DE_FORMATO}
          valor={formato}
          onCambio={onFormato}
        />
      )}

      {tipo === 'BOLETA' && boletaExigeCliente(total) ? (
        <Aviso tipo="alerta" titulo="Más de S/ 700: pide nombre y documento">
          Una boleta de más de S/ 700.00 necesita los datos del cliente.
        </Aviso>
      ) : null}

      {visible ? (
        <div className="cobro__cliente">
          {tipo === 'BOLETA' ? (
            <Segmentos
              etiqueta="Documento del cliente"
              opciones={DOCUMENTOS_DE_BOLETA}
              valor={documento}
              onCambio={(tipoDocumento) => poner({ tipoDocumento, numero: '' })}
            />
          ) : null}
          <CampoTexto
            etiqueta={tipo === 'FACTURA' ? 'RUC' : `Número de ${NOMBRE_DE_DOCUMENTO[documento]}`}
            value={cliente.numero}
            onChange={(e) =>
              poner({
                numero:
                  documento === 'DNI' || documento === 'RUC'
                    ? e.target.value.replace(/\D/g, '').slice(0, documento === 'DNI' ? 8 : 11)
                    : e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12),
              })
            }
            inputMode={documento === 'DNI' || documento === 'RUC' ? 'numeric' : 'text'}
            autoComplete="off"
            {...(errores?.numero ? { error: errores.numero } : {})}
          />
          <CampoTexto
            etiqueta={tipo === 'FACTURA' ? 'Razón social' : 'Nombre del cliente'}
            value={cliente.nombre}
            onChange={(e) => poner({ nombre: e.target.value.slice(0, 200) })}
            autoComplete="off"
            {...(errores?.nombre ? { error: errores.nombre } : {})}
          />
          {tipo === 'FACTURA' ? (
            <CampoTexto
              etiqueta="Dirección fiscal"
              value={cliente.direccion}
              onChange={(e) => poner({ direccion: e.target.value.slice(0, 300) })}
              autoComplete="off"
              {...(errores?.direccion ? { error: errores.direccion } : {})}
            />
          ) : null}
        </div>
      ) : (
        <Boton onClick={() => setConCliente(true)}>Agregar datos del cliente</Boton>
      )}
    </section>
  );
}
