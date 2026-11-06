import {
  Aviso,
  Boton,
  Casilla,
  CampoTexto,
  Segmentos,
  type OpcionDeSegmento,
} from '@restaurante/ui';
import { useState } from 'react';
import {
  NOMBRE_DE_DOCUMENTO,
  boletaExigeCliente,
  type ClienteEscrito,
  type ErroresDeCliente,
  type TipoDeDocumento,
} from './cobro';
import {
  TEXTO_DE_LA_MARCA,
  TITULO_PADRON_NO_DISPONIBLE,
  fechaDelPadron,
  type ClienteFacturaEstado,
} from './padron';
import './cliente-factura.css';

const DOCUMENTOS_DE_BOLETA: readonly OpcionDeSegmento<TipoDeDocumento>[] = [
  { valor: 'DNI', etiqueta: NOMBRE_DE_DOCUMENTO.DNI },
  { valor: 'CE', etiqueta: NOMBRE_DE_DOCUMENTO.CE },
  { valor: 'PASAPORTE', etiqueta: NOMBRE_DE_DOCUMENTO.PASAPORTE },
  { valor: 'RUC', etiqueta: NOMBRE_DE_DOCUMENTO.RUC },
];

interface Props {
  tipo: 'BOLETA' | 'FACTURA';
  /** El total del comprobante, para el aviso de las boletas de más de S/ 700. */
  total: string;
  cliente: ClienteEscrito;
  onCliente: (cliente: ClienteEscrito) => void;
  /** Lo que falta o está mal; solo se muestra cuando la persona ya intentó emitir. */
  errores: ErroresDeCliente | null;
  /** El padrón y la marca «Emitir igual»: lo da `useClienteFactura`, que también usa quien cobra o emite. */
  padron: ClienteFacturaEstado;
}

/**
 * El cliente del comprobante, igual al cobrar, en la venta de mostrador, en «Emitir otro» y en el cambio a factura de
 * la nota de crédito (criterios 51, 139 a 141 y 176). La factura pide RUC, razón social y dirección fiscal, y al
 * completar un RUC válido llena los dos últimos con el padrón de SUNAT (se pueden corregir). Un RUC que no está
 * activo, no está habido o no figura lleva aviso y se emite solo con «Emitir igual». La boleta pide documento y
 * nombre si pasa de S/ 700 y, en los demás casos, el cliente es opcional; el DNI no se consulta (criterio 141).
 */
export function ClienteFactura({ tipo, total, cliente, onCliente, errores, padron }: Props) {
  const [conCliente, setConCliente] = useState(false);
  const exigido = tipo === 'FACTURA' || boletaExigeCliente(total);
  const visible = exigido || conCliente || cliente.numero !== '' || cliente.nombre !== '';
  const documento: TipoDeDocumento = tipo === 'FACTURA' ? 'RUC' : cliente.tipoDocumento;
  const poner = (cambio: Partial<ClienteEscrito>) => onCliente({ ...cliente, ...cambio });
  const { resultado } = padron;

  return (
    <div className="cliente-factura">
      {tipo === 'BOLETA' && boletaExigeCliente(total) ? (
        <Aviso tipo="alerta" titulo="Más de S/ 700: pide nombre y documento">
          Una boleta de más de S/ 700.00 necesita los datos del cliente.
        </Aviso>
      ) : null}

      {visible ? (
        <>
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

          {resultado.tipo === 'consultando' ? (
            <p className="texto-ayuda" role="status">
              Consultando el padrón de SUNAT…
            </p>
          ) : null}
          {resultado.tipo === 'encontrado' && resultado.aviso === null ? (
            <p className="texto-ayuda" role="status">
              Datos del padrón de SUNAT del {fechaDelPadron(resultado.datos.padronAl)}. Puedes
              corregirlos.
            </p>
          ) : null}
          {resultado.tipo === 'encontrado' && resultado.aviso !== null ? (
            <AvisoConMarca titulo={resultado.aviso} padron={padron} errores={errores} />
          ) : null}
          {resultado.tipo === 'no_figura' ? (
            <AvisoConMarca titulo={resultado.aviso} padron={padron} errores={errores} />
          ) : null}
          {resultado.tipo === 'no_disponible' ? (
            <Aviso tipo="info" titulo={TITULO_PADRON_NO_DISPONIBLE}>
              <p>Escribe el nombre y la dirección a mano.</p>
              <Boton variante="texto" onClick={padron.reconsultar} disabled={padron.reconsultando}>
                Consultar otra vez
              </Boton>
            </Aviso>
          ) : null}

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
              {...(resultado.tipo === 'encontrado' &&
              resultado.datos.direccion === null &&
              cliente.direccion === ''
                ? { ayuda: 'El padrón no trae la dirección de este RUC. Escríbela.' }
                : {})}
              {...(errores?.direccion ? { error: errores.direccion } : {})}
            />
          ) : null}
        </>
      ) : (
        <Boton onClick={() => setConCliente(true)}>Agregar datos del cliente</Boton>
      )}
    </div>
  );
}

/** El aviso del padrón y la casilla que lo deja pasar: sin la marca no se emite (criterio 140). */
function AvisoConMarca({
  titulo,
  padron,
  errores,
}: {
  titulo: string;
  padron: ClienteFacturaEstado;
  errores: ErroresDeCliente | null;
}) {
  return (
    <div className="cliente-factura__aviso">
      <Aviso tipo="alerta" titulo={titulo}>
        <p>Revisa el RUC con tu cliente, o marca «{TEXTO_DE_LA_MARCA}» para continuar.</p>
      </Aviso>
      <Casilla
        etiqueta={TEXTO_DE_LA_MARCA}
        marcada={padron.emitirIgual}
        onCambio={padron.onEmitirIgual}
        error={errores?.emitirIgual}
      />
    </div>
  );
}
