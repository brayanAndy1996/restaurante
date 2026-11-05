import {
  ContenidoDeFila,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  EtiquetaDeEstado,
  Icono,
  IconoDerecha,
  IconoPago,
  claseFila,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { horaDeLima } from '../../lib/formato';
import { montoEnSoles } from '../../lib/monto';
import { useIntervaloDeSondeo } from '../../lib/tiempo-real';
import { tituloDeMesas } from '../salon/ordenes';
import { rutaDeCobro } from './cobro';
import { claveDePorCobrar, listarPorCobrar } from './cuenta';
import { mensajeDeCaja } from './turno';
import './cuenta-caja.css';

/**
 * «Por cobrar» (criterios 37 y 110 de 006): las cuentas abiertas de la sucursal, de la más antigua a la más nueva, con
 * su saldo. Cada una abre su cobro; los descuentos y las cortesías se aplican desde su cuenta antes de cobrar.
 */
export function PorCobrar({ sucursalId }: { sucursalId: string }) {
  const clientes = useQueryClient();
  const sondeo = useIntervaloDeSondeo();
  const consulta = useQuery({
    queryKey: claveDePorCobrar(sucursalId),
    staleTime: 0,
    refetchInterval: sondeo,
    queryFn: ({ signal }) =>
      listarPorCobrar(signal, clientes.getQueryData(claveDePorCobrar(sucursalId)) !== undefined),
  });
  if (consulta.isPending) {
    return (
      <EsqueletoDeLista etiqueta="Cargando las cuentas por cobrar" filas={3} conInicial={false} />
    );
  }
  if (consulta.isError && consulta.data === undefined) {
    return (
      <ErrorDeCarga
        titulo="No pudimos cargar las cuentas"
        onReintentar={() => void consulta.refetch()}
        reintentando={consulta.isFetching}
      >
        {mensajeDeCaja(consulta.error)}
      </ErrorDeCarga>
    );
  }
  const cuentas = consulta.data ?? [];
  if (cuentas.length === 0) {
    return (
      <EstadoVacio icono={IconoPago} titulo="No hay cuentas abiertas">
        Cuando una mesa tenga consumo, aparecerá aquí.
      </EstadoVacio>
    );
  }
  return (
    <ul className="porcobrar__lista" aria-label="Cuentas por cobrar">
      {cuentas.map((c) => {
        const titulo = c.mesas.length > 0 ? tituloDeMesas(c.mesas) : 'Mostrador';
        return (
          <li key={c.ordenId}>
            <Link
              to={rutaDeCobro(c.ordenId)}
              state={{ desde: 'caja' }}
              className={claseFila()}
              aria-label={`${titulo}, saldo ${montoEnSoles(c.saldo) ?? ''}`}
            >
              <ContenidoDeFila
                titulo={titulo}
                ayuda={[c.mozo?.nombre, `desde las ${horaDeLima(c.abiertaEn)}`]
                  .filter(Boolean)
                  .join(' · ')}
                derecha={
                  <span className="porcobrar__monto">
                    <b>{montoEnSoles(c.saldo)}</b>
                    <Icono icono={IconoDerecha} tamano={20} />
                  </span>
                }
                extra={
                  c.estado === 'EN_PRECUENTA' ? (
                    <EtiquetaDeEstado tono="alerta">Pidieron la cuenta</EtiquetaDeEstado>
                  ) : undefined
                }
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
