import type { TrabajoResumen } from '@restaurante/contratos';
import {
  Boton,
  ContenidoDeFila,
  EtiquetaDeEstado,
  IconoImpresora,
  TablaResponsiva,
  type ColumnaDeTabla,
} from '@restaurante/ui';
import { horaDeLima } from '../../lib/formato';
import {
  ESTADO_DE_TRABAJO,
  TEXTO_DE_TIPO,
  textoDeIntentos,
  textoDeMesasDeTrabajo,
} from './trabajos';
import './trabajos.css';

interface Props {
  trabajos: readonly TrabajoResumen[];
  /** Nombre de la lista para los lectores de pantalla. */
  etiqueta: string;
  onReimprimir: (trabajoId: string) => void;
  /** El trabajo que se está reimprimiendo ahora, si hay uno. */
  enCurso: string | null;
  /** Un envío espera la red: el botón de `enCurso` lo dice. */
  pendiente: boolean;
  /** `false` en la cuenta de una mesa, donde todos los tickets son de la misma. */
  conMesa?: boolean;
}

function EtiquetasDeTrabajo({ trabajo }: { trabajo: TrabajoResumen }) {
  const estado = ESTADO_DE_TRABAJO[trabajo.estado];
  return (
    <span className="etiquetas">
      <EtiquetaDeEstado tono={estado.tono} icono={estado.icono}>
        {estado.texto}
      </EtiquetaDeEstado>
      {trabajo.estado === 'PENDIENTE' && trabajo.intentos > 0 ? (
        <EtiquetaDeEstado tono="alerta">{textoDeIntentos(trabajo.intentos)}</EtiquetaDeEstado>
      ) : null}
      {trabajo.reimpresionDe ? <EtiquetaDeEstado tono="info">Reimpresión</EtiquetaDeEstado> : null}
    </span>
  );
}

/**
 * Los trabajos de impresión del día (criterios 128 y 139): en celular, filas con el ticket, la impresora y la
 * hora; desde 768 px, una tabla. Cada ticket que no es la página de prueba lleva "Reimprimir".
 */
export function ListaDeTrabajos({
  trabajos,
  etiqueta,
  onReimprimir,
  enCurso,
  pendiente,
  conMesa = true,
}: Props) {
  const boton = (t: TrabajoResumen) => {
    if (t.tipo === 'PRUEBA') return null;
    const hace = enCurso === t.id;
    return (
      <Boton
        icono={IconoImpresora}
        cargando={hace}
        textoCargando={pendiente ? 'Pendiente de envío' : 'Reimprimiendo…'}
        disabled={enCurso !== null && !hace}
        onClick={() => onReimprimir(t.id)}
      >
        Reimprimir{' '}
        <span className="ui-solo-lectores">{`${TEXTO_DE_TIPO[t.tipo].toLowerCase()} de ${t.impresora.nombre} de las ${horaDeLima(t.creadoEn)}`}</span>
      </Boton>
    );
  };

  const columnas: ColumnaDeTabla<TrabajoResumen>[] = [
    {
      id: 'hora',
      encabezado: 'Hora',
      sinSaltos: true,
      celda: (t) => horaDeLima(t.creadoEn),
    },
    { id: 'tipo', encabezado: 'Ticket', celda: (t) => <b>{TEXTO_DE_TIPO[t.tipo]}</b> },
    { id: 'impresora', encabezado: 'Impresora', celda: (t) => t.impresora.nombre },
    ...(conMesa
      ? [
          {
            id: 'mesa',
            encabezado: 'Mesa',
            sinSaltos: true,
            celda: (t: TrabajoResumen) => textoDeMesasDeTrabajo(t.mesa) ?? '—',
          },
        ]
      : []),
    { id: 'estado', encabezado: 'Estado', celda: (t) => <EtiquetasDeTrabajo trabajo={t} /> },
    {
      id: 'acciones',
      encabezado: 'Acciones',
      encabezadoOculto: true,
      alinear: 'derecha',
      sinSaltos: true,
      celda: (t) => boton(t),
    },
  ];

  return (
    <TablaResponsiva
      etiqueta={etiqueta}
      filas={[...trabajos]}
      clave={(t) => t.id}
      filaEnLista={(t) => {
        const mesa = conMesa ? textoDeMesasDeTrabajo(t.mesa) : null;
        return (
          <div className="ui-fila trabajo">
            <ContenidoDeFila
              titulo={mesa ? `${TEXTO_DE_TIPO[t.tipo]} · ${mesa}` : TEXTO_DE_TIPO[t.tipo]}
              ayuda={`${t.impresora.nombre} · ${horaDeLima(t.creadoEn)}`}
              derecha={boton(t)}
              extra={<EtiquetasDeTrabajo trabajo={t} />}
            />
          </div>
        );
      }}
      columnas={columnas}
    />
  );
}
