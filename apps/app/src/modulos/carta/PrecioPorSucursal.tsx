import type { AjusteSucursalRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  CampoMonto,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  EtiquetaDeEstado,
  Icono,
  IconoAlerta,
  IconoBloqueo,
  IconoCandado,
  IconoExito,
  IconoOk,
  IconoTienda,
  Interruptor,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { EtiquetaPendiente } from '../../componentes/PendienteDeEnvio';
import { useEnvioPendiente } from '../../lib/envios';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { formatearMonto, montoEnSoles } from '../../lib/monto';
import { CLAVES, ajustarSucursalDeProducto, listarSucursalesDeProducto } from './carta';
import {
  ajusteDeBorrador,
  borradorDeSucursal,
  falloDeAjuste,
  hayCambiosDeSucursal,
  type BorradorDeSucursal,
} from './sucursales-form';

/** "S/ 38.00" (`montoEnSoles` ya usa espacio duro: el monto no se parte entre dos líneas). */
function soles(monto: string | null): string | null {
  return montoEnSoles(monto);
}

/** Nota de las filas que quien consulta no puede cambiar (criterio 73). */
export const NOTA_SOLO_LECTURA = 'Solo la cambia el Administrador o un Cajero de esta sucursal.';

interface Props {
  productoId: string;
  /** Precio de la empresa tal como está guardado (`null` si el producto no se vende solo). */
  precioEmpresa: string | null;
  seVendeSolo: boolean;
}

/**
 * "Precio por sucursal" (HU-06, criterio 73): una fila por sucursal con el precio efectivo, un campo de
 * precio propio (vacío = el de la empresa) y el interruptor "Disponible". Cada fila se guarda por
 * separado; las que `editable: false` marca la API se muestran solo para leer, con su nota.
 */
export function PrecioPorSucursal({ productoId, precioEmpresa, seVendeSolo }: Props) {
  const filas = useQuery({
    queryKey: CLAVES.sucursalesDeProducto(productoId),
    queryFn: ({ signal }) => listarSucursalesDeProducto(productoId, signal),
  });

  const precioDeLaEmpresa = soles(precioEmpresa);
  return (
    <section className="seccion" aria-labelledby="producto-sucursales">
      <h2 className="formulario__titulo" id="producto-sucursales">
        Precio por sucursal
      </h2>
      <p className="texto-ayuda">
        {seVendeSolo
          ? `Cambia el precio o la disponibilidad solo en una sucursal. Sin precio propio, se usa el de la empresa${
              precioDeLaEmpresa ? ` (${precioDeLaEmpresa})` : ''
            }.`
          : 'Este producto no se vende solo, así que no lleva precio. Aquí decides en qué sucursales está disponible.'}
      </p>

      {filas.isPending ? (
        <EsqueletoDeLista filas={2} conInicial={false} etiqueta="Cargando sucursales" />
      ) : filas.isError ? (
        <ErrorDeCarga
          titulo={
            filas.error instanceof ErrorApi && filas.error.sinConexion
              ? 'Sin conexión'
              : 'No pudimos cargar las sucursales'
          }
          onReintentar={() => void filas.refetch()}
          reintentando={filas.isFetching}
        >
          {mensajeDeError(filas.error, {
            PROHIBIDO: 'No tienes permiso para ver el precio por sucursal de este producto.',
            NO_ENCONTRADO: 'Puede que este producto ya no exista. Vuelve a la carta.',
          })}
        </ErrorDeCarga>
      ) : filas.data.length === 0 ? (
        <EstadoVacio icono={IconoTienda} titulo="Aún no hay sucursales">
          Cuando la empresa tenga una sucursal, aquí podrás cambiar su precio.
        </EstadoVacio>
      ) : (
        <ul className="sucursales">
          {filas.data.map((fila) => (
            <FilaDeSucursal
              key={fila.sucursalId}
              productoId={productoId}
              fila={fila}
              precioEmpresa={precioEmpresa}
              seVendeSolo={seVendeSolo}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Etiquetas de estado de la fila: la disponibilidad (solo en las de lectura, donde no hay interruptor) y "Agotado". */
function Estados({
  fila,
  conDisponibilidad,
}: {
  fila: AjusteSucursalRespuesta;
  conDisponibilidad: boolean;
}) {
  if (!conDisponibilidad && !fila.agotado) return null;
  return (
    <div className="etiquetas">
      {conDisponibilidad ? (
        fila.disponible ? (
          <EtiquetaDeEstado tono="ok" icono={IconoOk}>
            Disponible
          </EtiquetaDeEstado>
        ) : (
          <EtiquetaDeEstado tono="neutro" icono={IconoBloqueo}>
            No disponible
          </EtiquetaDeEstado>
        )
      ) : null}
      {fila.agotado ? (
        <EtiquetaDeEstado tono="alerta" icono={IconoAlerta}>
          Agotado
        </EtiquetaDeEstado>
      ) : null}
    </div>
  );
}

function PrecioEfectivo({
  fila,
  precioEmpresa,
}: {
  fila: AjusteSucursalRespuesta;
  precioEmpresa: string | null;
}) {
  const efectivo = montoEnSoles(fila.precioEfectivo);
  if (efectivo === null) return null;
  const deLaEmpresa = soles(precioEmpresa);
  return (
    <p className="sucursal__precio">
      <span className="texto-ayuda">Precio en esta sucursal</span>
      <b className="sucursal__monto">{efectivo}</b>
      <span className="texto-ayuda">
        {fila.precio !== null
          ? deLaEmpresa
            ? `Precio propio. La empresa cobra ${deLaEmpresa}.`
            : 'Precio propio de esta sucursal.'
          : 'Es el precio de la empresa.'}
      </span>
    </p>
  );
}

interface PropsFila {
  productoId: string;
  fila: AjusteSucursalRespuesta;
  precioEmpresa: string | null;
  seVendeSolo: boolean;
}

function FilaDeSucursal({ productoId, fila, precioEmpresa, seVendeSolo }: PropsFila) {
  const clientes = useQueryClient();
  const envio = useEnvioPendiente();
  const [borrador, setBorrador] = useState<BorradorDeSucursal>(() => borradorDeSucursal(fila));
  const [errorDePrecio, setErrorDePrecio] = useState<string | undefined>();
  const [fallo, setFallo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardada, setGuardada] = useState(false);

  const titulo = `sucursal-${fila.sucursalId}`;

  if (!fila.editable) {
    return (
      <li className="sucursal" aria-labelledby={titulo}>
        <div className="sucursal__encabezado">
          <h3 className="sucursal__nombre" id={titulo}>
            {fila.nombre}
          </h3>
          <Estados fila={fila} conDisponibilidad />
        </div>
        {seVendeSolo ? <PrecioEfectivo fila={fila} precioEmpresa={precioEmpresa} /> : null}
        <p className="sucursal__nota">
          <Icono icono={IconoCandado} tamano={16} />
          <span>{NOTA_SOLO_LECTURA}</span>
        </p>
        {fallo ? (
          <Aviso tipo="error" titulo={`No pudimos guardar ${fila.nombre}`}>
            {fallo}
          </Aviso>
        ) : null}
      </li>
    );
  }

  const cambios = hayCambiosDeSucursal(fila, borrador);

  function cambiar(parcial: Partial<BorradorDeSucursal>) {
    setBorrador((b) => ({ ...b, ...parcial }));
    setGuardada(false);
    setFallo(null);
    if ('precio' in parcial) setErrorDePrecio(undefined);
  }

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (guardando || !cambios) return;
    const ajuste = ajusteDeBorrador(borrador, seVendeSolo);
    if (ajuste.error !== undefined) {
      setErrorDePrecio(ajuste.error);
      return;
    }
    setGuardando(true);
    setFallo(null);
    setErrorDePrecio(undefined);
    try {
      const guardadaAhora = await envio.enviar((extra) =>
        ajustarSucursalDeProducto(productoId, fila.sucursalId, ajuste.entrada, extra),
      );
      clientes.setQueryData<AjusteSucursalRespuesta[]>(
        CLAVES.sucursalesDeProducto(productoId),
        (previas) =>
          previas?.map((f) => (f.sucursalId === guardadaAhora.sucursalId ? guardadaAhora : f)),
      );
      setBorrador(borradorDeSucursal(guardadaAhora));
      setGuardada(true);
    } catch (e) {
      const dicho = falloDeAjuste(e);
      setFallo(dicho.mensaje);
      setErrorDePrecio(dicho.precio);
      if (dicho.releer) {
        void clientes.invalidateQueries({ queryKey: CLAVES.sucursalesDeProducto(productoId) });
      }
    } finally {
      setGuardando(false);
    }
  }

  return (
    <li className="sucursal" aria-labelledby={titulo}>
      <div className="sucursal__encabezado">
        <h3 className="sucursal__nombre" id={titulo}>
          {fila.nombre}
        </h3>
        <Estados fila={fila} conDisponibilidad={false} />
      </div>
      {seVendeSolo ? <PrecioEfectivo fila={fila} precioEmpresa={precioEmpresa} /> : null}
      <form className="sucursal__formulario" onSubmit={(e) => void guardar(e)} noValidate>
        {seVendeSolo ? (
          <CampoMonto
            etiqueta="Precio propio"
            opcional
            value={borrador.precio}
            onValor={(precio) => cambiar({ precio })}
            error={errorDePrecio}
            placeholder={formatearMonto(precioEmpresa ?? '') ?? undefined}
            ayuda="Vacío: usa el precio de la empresa."
            aria-label={`Precio propio en ${fila.nombre}`}
          />
        ) : null}
        <Interruptor
          etiqueta="Disponible"
          nombreAccesible={`Disponible en ${fila.nombre}`}
          marcado={borrador.disponible}
          onCambio={(disponible) => cambiar({ disponible })}
        />
        {fallo ? (
          <Aviso tipo="error" titulo={`No pudimos guardar ${fila.nombre}`}>
            {fallo}
          </Aviso>
        ) : null}
        <div className="sucursal__acciones">
          <Boton
            type="submit"
            cargando={guardando}
            textoCargando="Guardando…"
            disabled={!cambios}
            aria-label={`Guardar ${fila.nombre}`}
          >
            Guardar
          </Boton>
          <span className="sucursal__guardada" role="status">
            {envio.pendiente ? (
              <EtiquetaPendiente />
            ) : guardada ? (
              <>
                <Icono icono={IconoExito} tamano={20} />
                Guardado
              </>
            ) : null}
          </span>
        </div>
      </form>
    </li>
  );
}
