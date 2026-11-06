import type {
  ComprobanteDetalle,
  ReemisionEntrada,
  ReemisionRespuesta,
} from '@restaurante/contratos';
import { Aviso, Boton, EtiquetaDeEstado, Segmentos, type OpcionDeSegmento } from '@restaurante/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ClienteFactura } from '../caja/ClienteFactura';
import { CLIENTE_VACIO, type ClienteEscrito } from '../caja/cobro';
import { useClienteFactura } from '../caja/padron';
import { EstadoDeLaImpresion } from '../caja/impresion-caja';
import { EstadoDelComprobante } from './EstadoDelComprobante';
import { NOMBRE_DE_TIPO_DOCUMENTO } from './facturacion';
import { ID_FORMULARIO_DE_REEMISION } from './ids';
import './panel.css';

type Tipo = 'BOLETA' | 'FACTURA';

const OPCIONES_DE_TIPO: readonly OpcionDeSegmento<Tipo>[] = [
  { valor: 'BOLETA', etiqueta: 'Boleta' },
  { valor: 'FACTURA', etiqueta: 'Factura' },
];

/** El cliente del rechazado, listo para corregir: con él se llena el formulario. */
function clienteDelRechazado(cliente: ComprobanteDetalle['cliente']): ClienteEscrito {
  return cliente
    ? {
        tipoDocumento: cliente.tipoDocumento,
        numero: cliente.numero,
        nombre: cliente.nombre,
        direccion: cliente.direccion ?? '',
      }
    : CLIENTE_VACIO;
}

interface Props {
  comprobante: ComprobanteDetalle;
  enviando: boolean;
  /** Lo que dijo la API si no se pudo emitir. */
  fallo?: string | undefined;
  onEnviar: (entrada: ReemisionEntrada) => void;
  onCancelar: () => void;
}

/**
 * «Emitir otro» (criterio 134): corrige un comprobante rechazado con uno nuevo, con otro número y los mismos productos
 * y montos. El tipo y el cliente se pueden corregir (se parte de los del rechazado); una nota de crédito rechazada se
 * emite igual, sin cambios. Los datos del cliente siguen las reglas del cobro (factura con RUC y dirección, boleta de más
 * de S/ 700 con documento y nombre). El formulario vive en la pantalla del detalle: no hace falta una ventana aparte.
 */
export function EmitirOtro({ comprobante, enviando, fallo, onEnviar, onCancelar }: Props) {
  const esNota = comprobante.tipo.startsWith('NOTA_CREDITO');
  const soloBoletas = comprobante.emisor.regimen === 'NUEVO_RUS';
  const total = comprobante.totales.total;
  const [tipo, setTipo] = useState<Tipo>(
    comprobante.tipo === 'FACTURA' && !soloBoletas ? 'FACTURA' : 'BOLETA',
  );
  const [cliente, setCliente] = useState<ClienteEscrito>(() =>
    clienteDelRechazado(comprobante.cliente),
  );
  const [intentado, setIntentado] = useState(false);
  const raiz = useRef<HTMLFormElement>(null);
  useEffect(() => {
    raiz.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const padron = useClienteFactura(tipo, total, cliente, setCliente);
  const validacion = padron.validado;
  const errores = intentado && !validacion.ok ? validacion.errores : null;

  function elegirTipo(nuevo: Tipo) {
    setTipo(nuevo);
    // Una factura es de un RUC: un DNI de la boleta no sirve y se vuelve a escribir.
    if (nuevo === 'FACTURA' && cliente.tipoDocumento !== 'RUC') {
      setCliente({ ...cliente, tipoDocumento: 'RUC', numero: '' });
    }
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    if (esNota) return onEnviar({ tipo: comprobante.tipo });
    setIntentado(true);
    if (!validacion.ok) {
      requestAnimationFrame(() =>
        raiz.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    onEnviar({ tipo, ...(validacion.cliente ? { cliente: validacion.cliente } : {}) });
  }

  return (
    <form
      ref={raiz}
      id={ID_FORMULARIO_DE_REEMISION}
      className="emitir"
      onSubmit={enviar}
      noValidate
      aria-labelledby="emitir-titulo"
    >
      <h2 id="emitir-titulo">Emitir otro comprobante</h2>
      <p className="texto-ayuda">
        {esNota
          ? `Se emitirá otra ${NOMBRE_DE_TIPO_DOCUMENTO[comprobante.tipo].toLowerCase()} con los mismos datos y otro número.`
          : 'El comprobante rechazado conserva su número. El nuevo lleva otro número y los mismos productos y montos; corrige lo que haga falta.'}
      </p>
      {fallo ? (
        <Aviso tipo="error" titulo="No pudimos emitir otro">
          {fallo}
        </Aviso>
      ) : null}

      {esNota ? null : (
        <>
          {soloBoletas ? (
            <p className="texto-ayuda">
              Esta empresa solo emite boletas, por su régimen tributario.
            </p>
          ) : (
            <Segmentos
              etiqueta="Tipo de comprobante"
              opciones={OPCIONES_DE_TIPO}
              valor={tipo}
              onCambio={elegirTipo}
            />
          )}

          <ClienteFactura
            tipo={tipo}
            total={total}
            cliente={cliente}
            onCliente={setCliente}
            errores={errores}
            padron={padron}
          />
        </>
      )}

      <div className="emitir__salida">
        <Boton variante="texto" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}

/** Lo que pasó al emitir otro: el comprobante nuevo con su estado en vivo y si salió su ticket (criterio 134). */
export function ReemisionHecha({ respuesta }: { respuesta: ReemisionRespuesta }) {
  const nuevo = respuesta.comprobante;
  return (
    <section className="emitir" aria-labelledby="emitido-titulo">
      <h2 id="emitido-titulo">Comprobante nuevo emitido</h2>
      <Aviso tipo="ok" titulo={`${NOMBRE_DE_TIPO_DOCUMENTO[nuevo.tipo]} ${nuevo.numero}`}>
        Reemplaza al rechazado. Ya se está enviando a SUNAT.
      </Aviso>
      {nuevo.simulado ? <EtiquetaDeEstado tono="alerta">Simulado</EtiquetaDeEstado> : null}
      <EstadoDelComprobante comprobante={nuevo} sinAcciones />
      <EstadoDeLaImpresion impresion={respuesta.impresion} trabajoId={respuesta.trabajoId} />
    </section>
  );
}
