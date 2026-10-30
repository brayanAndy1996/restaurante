import type { TrabajoResumen } from '@restaurante/contratos';
import {
  Boton,
  ContenidoDeFila,
  EtiquetaDeEstado,
  IconoError,
  IconoImpresora,
  TablaResponsiva,
  type ColumnaDeTabla,
} from '@restaurante/ui';
import { horaDeLima } from '../../lib/formato';
import {
  ESTADO_DE_TRABAJO,
  EXPLICACION_DE_ARMADO_FALLIDO,
  TEXTO_DE_TIPO,
  noSePudoArmar,
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
  const sinArmar = noSePudoArmar(trabajo);
  return (
    <span className="etiquetas">
      {sinArmar ? (
        // "Pendiente" prometería una impresión que no va a ocurrir: el ticket ni siquiera existe.
        <EtiquetaDeEstado tono="mal" icono={IconoError}>
          No se pudo armar el ticket
        </EtiquetaDeEstado>
      ) : (
        <EtiquetaDeEstado tono={estado.tono} icono={estado.icono}>
          {estado.texto}
        </EtiquetaDeEstado>
      )}
      {!sinArmar && trabajo.estado === 'PENDIENTE' && trabajo.intentos > 0 ? (
        <EtiquetaDeEstado tono="alerta">{textoDeIntentos(trabajo.intentos)}</EtiquetaDeEstado>
      ) : null}
      {trabajo.reimpresionDe ? <EtiquetaDeEstado tono="info">Reimpresión</EtiquetaDeEstado> : null}
    </span>
  );
}

/** Las etiquetas del trabajo y, si el ticket no se pudo armar, por qué no salió y qué hacer. */
function EstadoDeTrabajo({ trabajo }: { trabajo: TrabajoResumen }) {
  return (
    <>
      <EtiquetasDeTrabajo trabajo={trabajo} />
      {noSePudoArmar(trabajo) ? (
        <p className="texto-ayuda trabajo__falla">{EXPLICACION_DE_ARMADO_FALLIDO}</p>
      ) : null}
    </>
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
  /**
   * "Reimprimir". En la tabla (tableta) va solo con el icono, para que la fila quepa en la columna de
   * Ajustes sin desplazarse; su nombre accesible es el mismo que el del botón con texto.
   */
  const boton = (t: TrabajoResumen, soloIcono = false) => {
    if (t.tipo === 'PRUEBA') return null;
    const hace = enCurso === t.id;
    const contexto = `${TEXTO_DE_TIPO[t.tipo].toLowerCase()} de ${t.impresora.nombre} de las ${horaDeLima(t.creadoEn)}`;
    return (
      <Boton
        icono={IconoImpresora}
        cargando={hace}
        {...(soloIcono
          ? { title: 'Reimprimir' }
          : { textoCargando: pendiente ? 'Pendiente de envío' : 'Reimprimiendo…' })}
        disabled={enCurso !== null && !hace}
        onClick={() => onReimprimir(t.id)}
      >
        {soloIcono ? (
          <span className="ui-solo-lectores">{`Reimprimir ${contexto}`}</span>
        ) : (
          <>
            Reimprimir <span className="ui-solo-lectores">{contexto}</span>
          </>
        )}
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
    {
      // El tipo y la mesa van juntos: una columna menos.
      id: 'tipo',
      sinSaltos: true,
      encabezado: conMesa ? 'Ticket y mesa' : 'Ticket',
      celda: (t) => {
        const mesa = conMesa ? textoDeMesasDeTrabajo(t.mesa) : null;
        return (
          <>
            <b>{TEXTO_DE_TIPO[t.tipo]}</b>
            {mesa ? <span className="trabajo__mesa">{mesa}</span> : null}
          </>
        );
      },
    },
    { id: 'impresora', encabezado: 'Impresora', celda: (t) => t.impresora.nombre },
    { id: 'estado', encabezado: 'Estado', celda: (t) => <EstadoDeTrabajo trabajo={t} /> },
    {
      id: 'acciones',
      encabezado: 'Acciones',
      encabezadoOculto: true,
      alinear: 'derecha',
      sinSaltos: true,
      celda: (t) => boton(t, true),
    },
  ];

  return (
    <div className="trabajos">
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
                extra={<EstadoDeTrabajo trabajo={t} />}
              />
            </div>
          );
        }}
        columnas={columnas}
      />
    </div>
  );
}
