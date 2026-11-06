import { Segmentos, type OpcionDeSegmento } from '@restaurante/ui';
import { ClienteFactura } from './ClienteFactura';
import { type ClienteEscrito, type ErroresDeCliente, type FormatoDeCobro } from './cobro';
import type { ClienteFacturaEstado } from './padron';

type Tipo = 'BOLETA' | 'FACTURA';

const OPCIONES_DE_TIPO: readonly OpcionDeSegmento<Tipo>[] = [
  { valor: 'BOLETA', etiqueta: 'Boleta' },
  { valor: 'FACTURA', etiqueta: 'Factura' },
];
const OPCIONES_DE_FORMATO: readonly OpcionDeSegmento<FormatoDeCobro>[] = [
  { valor: 'DETALLADO', etiqueta: 'Detallado' },
  { valor: 'CONSUMO', etiqueta: 'Por consumo' },
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
  /** El padrón de RUC y la marca «Emitir igual» del cliente (criterios 140 y 176). */
  padron: ClienteFacturaEstado;
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
  padron,
}: Props) {
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

      <ClienteFactura
        tipo={tipo}
        total={total}
        cliente={cliente}
        onCliente={onCliente}
        errores={errores}
        padron={padron}
      />
    </section>
  );
}
