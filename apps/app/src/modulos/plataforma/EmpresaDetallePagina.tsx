import type { EmpresaPlataformaDetalle } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  ContenidoDeFila,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  EtiquetaDeEstado,
  Icono,
  IconoDerecha,
  IconoEmpresa,
  IconoEscudo,
  IconoMas,
  ListaDeFilas,
  claseBoton,
  claseFila,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { fechaDeLima, formatearFecha } from '../../lib/formato';
import {
  CLAVES,
  NOMBRE_DE_REGIMEN,
  TEXTO_DE_ESTADO,
  obtenerEmpresa,
  textoDePlan,
} from './plataforma';
import { HojaDeSoporte } from './SoporteHoja';

/** Detalle de una empresa (criterio 101): sucursales con su suscripción, emisores y administradores. */
export function EmpresaDetallePagina() {
  const { id = '' } = useParams();
  const aviso = (useLocation().state as { aviso?: string } | null)?.aviso;
  const [soporte, setSoporte] = useState(false);
  const consulta = useQuery({
    queryKey: CLAVES.empresa(id),
    queryFn: ({ signal }) => obtenerEmpresa(id, signal),
  });
  const atras = { a: '/plataforma', etiqueta: 'Empresas' };

  if (consulta.isPending) {
    return (
      <Pagina titulo="Empresa" plataforma atras={atras}>
        <EsqueletoDeLista etiqueta="Cargando la empresa" conInicial={false} filas={3} />
      </Pagina>
    );
  }
  if (consulta.isError) {
    const noExiste =
      consulta.error instanceof ErrorApi && consulta.error.codigo === 'NO_ENCONTRADO';
    return (
      <Pagina titulo="Empresa" plataforma atras={atras}>
        <ErrorDeCarga
          titulo={noExiste ? 'No encontramos esta empresa' : 'No pudimos cargar la empresa'}
          onReintentar={() => void consulta.refetch()}
          reintentando={consulta.isFetching}
        >
          {noExiste
            ? 'Puede que ya no exista. Vuelve a la lista de empresas.'
            : mensajeDeError(consulta.error)}
        </ErrorDeCarga>
      </Pagina>
    );
  }

  const empresa = consulta.data;
  return (
    <Pagina titulo={empresa.nombre} plataforma atras={atras} ancho="ancho">
      {aviso ? (
        <Aviso tipo="ok" titulo="Listo">
          {aviso}
        </Aviso>
      ) : null}
      <div className="encabezado-de-detalle">
        <p className="ui-subtitulo">Registrada el {fechaDeLima(empresa.creadoEn)}</p>
        <Boton icono={IconoEscudo} onClick={() => setSoporte(true)}>
          Entrar a dar soporte <span className="ui-solo-lectores">{`en ${empresa.nombre}`}</span>
        </Boton>
      </div>

      <SeccionSucursales empresa={empresa} />
      <SeccionEmisores empresa={empresa} />
      <SeccionAdministradores empresa={empresa} />

      <HojaDeSoporte
        key={soporte ? 'abierta' : 'cerrada'}
        empresa={soporte ? empresa : null}
        onCerrar={() => setSoporte(false)}
      />
    </Pagina>
  );
}

function SeccionSucursales({ empresa }: { empresa: EmpresaPlataformaDetalle }) {
  const emisorDe = new Map(empresa.emisores.map((e) => [e.id, e]));
  const suscripcionDe = new Map(empresa.suscripciones.map((s) => [s.sucursalId, s]));
  return (
    <section className="seccion" aria-labelledby="t-sucursales">
      <h2 className="formulario__titulo" id="t-sucursales">
        Sucursales
      </h2>
      {empresa.sucursales.length === 0 ? (
        <EstadoVacio icono={IconoEmpresa} titulo="Sin sucursales">
          Agrega la primera sucursal para que la empresa pueda trabajar.
        </EstadoVacio>
      ) : (
        <ListaDeFilas etiqueta="Sucursales">
          {empresa.sucursales.map((s) => {
            const suscripcion = suscripcionDe.get(s.id);
            const estado = suscripcion ? TEXTO_DE_ESTADO[suscripcion.estado] : null;
            const contenido = (
              <ContenidoDeFila
                titulo={s.nombre}
                ayuda={`${emisorDe.get(s.emisorId)?.razonSocial ?? 'Emisor'} · código ${s.codigoEstablecimiento}`}
                derecha={suscripcion ? <Icono icono={IconoDerecha} /> : null}
                extra={
                  suscripcion && estado ? (
                    <>
                      <EtiquetaDeEstado tono={estado.tono}>{estado.texto}</EtiquetaDeEstado>
                      <span className="texto-ayuda">{`${textoDePlan(suscripcion.plan.nombre)} · vence el ${formatearFecha(suscripcion.vencimiento)}`}</span>
                    </>
                  ) : (
                    <EtiquetaDeEstado tono="neutro">Sin suscripción</EtiquetaDeEstado>
                  )
                }
              />
            );
            return (
              <li key={s.id}>
                {suscripcion ? (
                  <Link to={`/plataforma/suscripciones/${suscripcion.id}`} className={claseFila()}>
                    {contenido}
                  </Link>
                ) : (
                  <div className={claseFila()}>{contenido}</div>
                )}
              </li>
            );
          })}
        </ListaDeFilas>
      )}
      <Link
        to={`/plataforma/empresas/${empresa.id}/sucursales/nueva`}
        className={claseBoton('secundario')}
      >
        <Icono icono={IconoMas} tamano={20} />
        Agregar sucursal
      </Link>
    </section>
  );
}

function SeccionEmisores({ empresa }: { empresa: EmpresaPlataformaDetalle }) {
  return (
    <section className="seccion" aria-labelledby="t-emisores">
      <h2 className="formulario__titulo" id="t-emisores">
        Emisores
      </h2>
      <ListaDeFilas etiqueta="Emisores">
        {empresa.emisores.map((e) => (
          <li key={e.id}>
            <div className={claseFila()}>
              <ContenidoDeFila
                titulo={e.razonSocial}
                ayuda={`RUC ${e.ruc} · ${NOMBRE_DE_REGIMEN[e.regimen]}`}
              />
            </div>
          </li>
        ))}
      </ListaDeFilas>
      <Link
        to={`/plataforma/empresas/${empresa.id}/emisores/nuevo`}
        className={claseBoton('secundario')}
      >
        <Icono icono={IconoMas} tamano={20} />
        Agregar emisor
      </Link>
    </section>
  );
}

function SeccionAdministradores({ empresa }: { empresa: EmpresaPlataformaDetalle }) {
  return (
    <section className="seccion" aria-labelledby="t-administradores">
      <h2 className="formulario__titulo" id="t-administradores">
        Administradores
      </h2>
      <ListaDeFilas etiqueta="Administradores">
        {empresa.administradores.map((a) => (
          <li key={a.id}>
            <div className={claseFila(!a.activo)}>
              <ContenidoDeFila
                inicial={a.nombre}
                apagada={!a.activo}
                titulo={a.nombre}
                ayuda={a.nombreUsuario}
                derecha={
                  !a.activo ? <EtiquetaDeEstado tono="neutro">Inactivo</EtiquetaDeEstado> : null
                }
              />
            </div>
          </li>
        ))}
      </ListaDeFilas>
    </section>
  );
}
