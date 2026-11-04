import type { CajaRespuesta } from '@restaurante/contratos';
import {
  Boton,
  ContenidoDeFila,
  EtiquetaDeEstado,
  Icono,
  IconoAlerta,
  IconoDerecha,
  IconoPago,
  IconoPersona,
  TablaResponsiva,
  claseFila,
} from '@restaurante/ui';
import {
  NOMBRE_DE_TIPO,
  TIPOS,
  serieActiva,
  textoDeImpresora,
  textoDeTurno,
  type TipoSerie,
} from './cajas';

/** Estado de la caja con palabras y con icono: inactiva, sin series (no emite) o con quién la tiene abierta. */
function EtiquetasDeCaja({ caja }: { caja: CajaRespuesta }) {
  const sinSeries = TIPOS.every((tipo) => !serieActiva(caja, tipo));
  return (
    <span className="etiquetas">
      {caja.activa ? null : <EtiquetaDeEstado tono="neutro">Inactiva</EtiquetaDeEstado>}
      {caja.activa && sinSeries ? (
        <EtiquetaDeEstado tono="alerta" icono={IconoAlerta}>
          Sin series: no emite
        </EtiquetaDeEstado>
      ) : null}
      {TIPOS.map((tipo) => {
        const serie = serieActiva(caja, tipo);
        return serie ? (
          <EtiquetaDeEstado key={tipo} tono="neutro">
            {`${NOMBRE_DE_TIPO[tipo].plural} ${serie.serie}`}
          </EtiquetaDeEstado>
        ) : null;
      })}
      {caja.turnoAbierto ? (
        <EtiquetaDeEstado tono="info" icono={IconoPersona}>
          {`Abierta por ${caja.turnoAbierto.responsable.nombre}`}
        </EtiquetaDeEstado>
      ) : null}
    </span>
  );
}

function CeldaDeSerie({ caja, tipo }: { caja: CajaRespuesta; tipo: TipoSerie }) {
  const serie = serieActiva(caja, tipo);
  if (!serie) return <span className="texto-ayuda">Sin serie</span>;
  return <b>{serie.serie}</b>;
}

interface Props {
  cajas: readonly CajaRespuesta[];
  onElegir: (id: string) => void;
}

/** Lista de cajas de la sucursal: filas de 72 px en celular y tabla desde 768 px. */
export function ListaDeCajas({ cajas, onElegir }: Props) {
  return (
    <TablaResponsiva
      etiqueta="Cajas"
      filas={[...cajas]}
      clave={(c) => c.id}
      apagada={(c) => !c.activa}
      filaEnLista={(c) => (
        <button type="button" className={claseFila(!c.activa)} onClick={() => onElegir(c.id)}>
          <ContenidoDeFila
            izquierda={
              <span className={c.activa ? 'ui-inicial' : 'ui-inicial ui-inicial--apagada'}>
                <Icono icono={IconoPago} tamano={24} />
              </span>
            }
            apagada={!c.activa}
            titulo={c.nombre}
            ayuda={textoDeImpresora(c)}
            derecha={<Icono icono={IconoDerecha} />}
            extra={<EtiquetasDeCaja caja={c} />}
          />
        </button>
      )}
      columnas={[
        { id: 'nombre', encabezado: 'Nombre', celda: (c) => <b>{c.nombre}</b> },
        {
          id: 'impresora',
          encabezado: 'Impresora',
          celda: (c) => c.impresora?.nombre ?? 'De la sucursal',
        },
        {
          id: 'boletas',
          encabezado: 'Boletas',
          sinSaltos: true,
          celda: (c) => <CeldaDeSerie caja={c} tipo="BOLETA" />,
        },
        {
          id: 'facturas',
          encabezado: 'Facturas',
          sinSaltos: true,
          celda: (c) => <CeldaDeSerie caja={c} tipo="FACTURA" />,
        },
        {
          id: 'estado',
          encabezado: 'Estado',
          celda: (c) =>
            c.activa ? (
              <>
                {textoDeTurno(c)}
                {TIPOS.every((tipo) => !serieActiva(c, tipo)) ? (
                  <>
                    <br />
                    <EtiquetaDeEstado tono="alerta" icono={IconoAlerta}>
                      Sin series: no emite
                    </EtiquetaDeEstado>
                  </>
                ) : null}
              </>
            ) : (
              <EtiquetaDeEstado tono="neutro">Inactiva</EtiquetaDeEstado>
            ),
        },
        {
          id: 'acciones',
          encabezado: 'Acciones',
          encabezadoOculto: true,
          alinear: 'derecha',
          sinSaltos: true,
          celda: (c) => (
            <Boton onClick={() => onElegir(c.id)}>
              Editar <span className="ui-solo-lectores">{`la caja ${c.nombre}`}</span>
            </Boton>
          ),
        },
      ]}
    />
  );
}
