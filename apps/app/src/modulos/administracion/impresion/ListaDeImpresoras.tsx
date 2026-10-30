import type { EstadoImpresora, ImpresoraRespuesta } from '@restaurante/contratos';
import {
  Boton,
  ContenidoDeFila,
  EtiquetaDeEstado,
  Icono,
  IconoBluetooth,
  IconoDerecha,
  IconoError,
  IconoImpresora,
  IconoInfo,
  IconoOk,
  IconoPendiente,
  IconoRed,
  TablaResponsiva,
  claseFila,
  type LucideIcon,
  type TonoEtiqueta,
} from '@restaurante/ui';
import { detalleDeConexion, resumenDeImpresora, textoDePendientes } from './impresion';

const ESTADO: Record<EstadoImpresora, { tono: TonoEtiqueta; icono: LucideIcon; texto: string }> = {
  LISTA: { tono: 'ok', icono: IconoOk, texto: 'Lista' },
  NO_RESPONDE: { tono: 'mal', icono: IconoError, texto: 'No responde' },
  DESCONOCIDO: { tono: 'neutro', icono: IconoInfo, texto: 'Sin datos' },
};

/** Estado de la impresora con palabras y con icono (criterio 136); una desactivada solo dice "Inactiva". */
export function EtiquetasDeImpresora({
  impresora,
  conPendientes = true,
}: {
  impresora: ImpresoraRespuesta;
  conPendientes?: boolean;
}) {
  const estado = ESTADO[impresora.estado];
  return (
    <span className="etiquetas">
      {impresora.activa ? (
        <EtiquetaDeEstado tono={estado.tono} icono={estado.icono}>
          {estado.texto}
        </EtiquetaDeEstado>
      ) : (
        <EtiquetaDeEstado tono="neutro">Inactiva</EtiquetaDeEstado>
      )}
      {conPendientes && impresora.pendientes > 0 ? (
        <EtiquetaDeEstado tono="alerta" icono={IconoPendiente}>
          {textoDePendientes(impresora.pendientes)}
        </EtiquetaDeEstado>
      ) : null}
    </span>
  );
}

interface Props {
  impresoras: readonly ImpresoraRespuesta[];
  onElegir: (id: string) => void;
}

/** Lista de impresoras: filas de 72 px en celular y tabla desde 768 px. */
export function ListaDeImpresoras({ impresoras, onElegir }: Props) {
  return (
    <TablaResponsiva
      etiqueta="Impresoras"
      filas={[...impresoras]}
      clave={(i) => i.id}
      apagada={(i) => !i.activa}
      filaEnLista={(i) => (
        <button type="button" className={claseFila(!i.activa)} onClick={() => onElegir(i.id)}>
          <ContenidoDeFila
            izquierda={
              <span className={i.activa ? 'ui-inicial' : 'ui-inicial ui-inicial--apagada'}>
                <Icono
                  icono={i.conexion.tipo === 'RED' ? IconoImpresora : IconoBluetooth}
                  tamano={24}
                />
              </span>
            }
            apagada={!i.activa}
            titulo={i.nombre}
            ayuda={resumenDeImpresora(i)}
            derecha={<Icono icono={IconoDerecha} />}
            extra={<EtiquetasDeImpresora impresora={i} />}
          />
        </button>
      )}
      columnas={[
        { id: 'nombre', encabezado: 'Nombre', celda: (i) => <b>{i.nombre}</b> },
        {
          id: 'conexion',
          encabezado: 'Conexión',
          celda: (i) => (
            <>
              <Icono icono={i.conexion.tipo === 'RED' ? IconoRed : IconoBluetooth} tamano={16} />{' '}
              {i.conexion.tipo === 'RED' ? 'Red' : 'Bluetooth'}
              <br />
              <span className="texto-ayuda">{detalleDeConexion(i)}</span>
            </>
          ),
        },
        { id: 'papel', encabezado: 'Papel', sinSaltos: true, celda: (i) => `${i.anchoMm} mm` },
        {
          id: 'estado',
          encabezado: 'Estado',
          celda: (i) => <EtiquetasDeImpresora impresora={i} conPendientes={false} />,
        },
        {
          id: 'pendientes',
          encabezado: 'Pendientes',
          alinear: 'derecha',
          sinSaltos: true,
          celda: (i) => i.pendientes,
        },
        {
          id: 'acciones',
          encabezado: 'Acciones',
          encabezadoOculto: true,
          alinear: 'derecha',
          sinSaltos: true,
          celda: (i) => (
            <Boton onClick={() => onElegir(i.id)}>
              Ver y editar <span className="ui-solo-lectores">{`la impresora ${i.nombre}`}</span>
            </Boton>
          ),
        },
      ]}
    />
  );
}
