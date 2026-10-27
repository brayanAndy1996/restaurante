import type { EmpresaPlataformaResumen } from '@restaurante/contratos';
import {
  Boton,
  ContenidoDeFila,
  ErrorDeCarga,
  EstadoVacio,
  EsqueletoDeLista,
  EtiquetaDeEstado,
  Icono,
  IconoDerecha,
  IconoEmpresa,
  IconoEscudo,
  IconoMas,
  TablaResponsiva,
  claseBoton,
  claseFila,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { mensajeDeError } from '../../lib/errores';
import { fechaDeLima, pluralSucursales } from '../../lib/formato';
import { CLAVES, TEXTO_DE_ESTADO, listarEmpresas } from './plataforma';
import { HojaDeSoporte } from './SoporteHoja';

type Empresa = EmpresaPlataformaResumen;

function EtiquetasDeSucursales({ empresa }: { empresa: Empresa }) {
  return (
    <span className="etiquetas">
      {empresa.sucursales.map((s) => {
        const estado = s.estadoSuscripcion ? TEXTO_DE_ESTADO[s.estadoSuscripcion] : null;
        return (
          <EtiquetaDeEstado key={s.id} tono={estado?.tono ?? 'neutro'}>
            {`${s.nombre} · ${estado?.texto ?? 'Sin suscripción'}`}
          </EtiquetaDeEstado>
        );
      })}
    </span>
  );
}

/** Lista de empresas con el estado de suscripción de cada sucursal, el alta y la entrada a soporte (criterio 101). */
export function EmpresasPagina() {
  const [paraSoporte, setParaSoporte] = useState<Empresa | null>(null);
  const consulta = useQuery({
    queryKey: CLAVES.empresas,
    queryFn: ({ signal }) => listarEmpresas(signal),
  });
  const empresas = consulta.data ?? [];

  const nueva = (
    <Link to="/plataforma/empresas/nueva" className={`${claseBoton('principal')} boton-pie`}>
      <Icono icono={IconoMas} />
      Nueva empresa
    </Link>
  );

  return (
    <Pagina titulo="Empresas" plataforma ancho="ancho" pie={nueva}>
      {consulta.isPending ? (
        <EsqueletoDeLista etiqueta="Cargando empresas" conInicial={false} />
      ) : consulta.isError ? (
        <ErrorDeCarga
          titulo="No pudimos cargar las empresas"
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        >
          {mensajeDeError(consulta.error)}
        </ErrorDeCarga>
      ) : empresas.length === 0 ? (
        <EstadoVacio
          icono={IconoEmpresa}
          titulo="Aún no hay empresas"
          accion={
            <Link to="/plataforma/empresas/nueva" className={claseBoton('principal')}>
              <Icono icono={IconoMas} tamano={20} />
              Nueva empresa
            </Link>
          }
        >
          Registra a tu primer cliente con su emisor, sus sucursales y su primer administrador.
        </EstadoVacio>
      ) : (
        <TablaResponsiva
          etiqueta="Empresas"
          filas={empresas}
          clave={(e) => e.id}
          filaEnLista={(e) => (
            <div className="fila-con-accion">
              <Link to={`/plataforma/empresas/${e.id}`} className={claseFila()}>
                <ContenidoDeFila
                  titulo={e.nombre}
                  ayuda={pluralSucursales(e.sucursales.length)}
                  derecha={<Icono icono={IconoDerecha} />}
                  extra={<EtiquetasDeSucursales empresa={e} />}
                />
              </Link>
              <div className="fila-con-accion__accion">
                <Boton bloque icono={IconoEscudo} onClick={() => setParaSoporte(e)}>
                  Entrar a dar soporte <span className="ui-solo-lectores">{`en ${e.nombre}`}</span>
                </Boton>
              </div>
            </div>
          )}
          columnas={[
            {
              id: 'nombre',
              encabezado: 'Empresa',
              celda: (e) => (
                <Link to={`/plataforma/empresas/${e.id}`} className="enlace-texto enlace-nombre">
                  {e.nombre}
                </Link>
              ),
            },
            {
              id: 'sucursales',
              encabezado: 'Sucursales y suscripción',
              celda: (e) => <EtiquetasDeSucursales empresa={e} />,
            },
            {
              id: 'creada',
              encabezado: 'Registrada',
              alinear: 'derecha',
              celda: (e) => fechaDeLima(e.creadoEn),
            },
            {
              id: 'acciones',
              encabezado: 'Acciones',
              encabezadoOculto: true,
              alinear: 'derecha',
              sinSaltos: true,
              celda: (e) => (
                <Boton icono={IconoEscudo} onClick={() => setParaSoporte(e)}>
                  Entrar a dar soporte <span className="ui-solo-lectores">{`en ${e.nombre}`}</span>
                </Boton>
              ),
            },
          ]}
        />
      )}

      <HojaDeSoporte
        key={paraSoporte?.id ?? 'ninguna'}
        empresa={paraSoporte}
        onCerrar={() => setParaSoporte(null)}
      />
    </Pagina>
  );
}
