import type { GrupoRespuesta } from '@restaurante/contratos';
import {
  Boton,
  CampoTexto,
  ContenidoDeFila,
  ErrorDeCarga,
  EsqueletoDeLista,
  EstadoVacio,
  EtiquetaDeEstado,
  Icono,
  IconoDerecha,
  IconoGrupo,
  IconoMas,
  TablaResponsiva,
  claseBoton,
  claseFila,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { paraBuscar } from '../../lib/formato';
import { CLAVES, listarGrupos } from './carta';
import { pluralOpciones, reglaDeRespuesta, usoEnProductos } from './grupo-form';
import { MarcoDeCarta } from './MarcoDeCarta';

/** Más grupos que esto y aparece la búsqueda. */
const GRUPOS_PARA_BUSCAR = 6;

function ayudaDe(grupo: GrupoRespuesta): string {
  return `${reglaDeRespuesta(grupo)} · ${pluralOpciones(grupo.modificadores.length)}`;
}

/**
 * Modificadores de la carta (criterios 71 y 75): los grupos con su regla en palabras y cuántos productos
 * los usan. En celular cada grupo es una fila de 72 px; desde 768 px, una tabla. Crear y editar tienen su
 * propia pantalla (un grupo lleva muchas opciones); desactivar se explica en la del grupo.
 */
export function GruposLista() {
  const grupos = useQuery({
    queryKey: CLAVES.grupos,
    queryFn: ({ signal }) => listarGrupos(signal),
  });
  const [busqueda, setBusqueda] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);

  const todos = useMemo(() => grupos.data ?? [], [grupos.data]);
  const inactivos = todos.filter((g) => !g.activo).length;
  const texto = paraBuscar(busqueda);
  const visibles = todos.filter(
    (g) => (verInactivos || g.activo) && (texto === '' || paraBuscar(g.nombre).includes(texto)),
  );

  const cargando = grupos.isPending;
  const error = grupos.isError ? grupos.error : null;
  const pie =
    !cargando && !error ? (
      <Link to="/carta/grupos/nuevo" className={`${claseBoton('principal')} boton-pie`}>
        <Icono icono={IconoMas} />
        Nuevo grupo
      </Link>
    ) : undefined;

  return (
    <MarcoDeCarta actual="modificadores" {...(pie ? { pie } : {})}>
      {cargando ? (
        <EsqueletoDeLista etiqueta="Cargando modificadores" conInicial={false} />
      ) : error ? (
        <ErrorDeCarga
          titulo={
            error instanceof ErrorApi && error.sinConexion
              ? 'Sin conexión'
              : 'No pudimos cargar los modificadores'
          }
          onReintentar={() => void grupos.refetch()}
          reintentando={grupos.isFetching}
        >
          {mensajeDeError(error)}
        </ErrorDeCarga>
      ) : todos.length === 0 ? (
        <EstadoVacio
          icono={IconoGrupo}
          titulo="Aún no hay grupos de modificadores"
          accion={
            <Link to="/carta/grupos/nuevo" className={claseBoton('principal')}>
              <Icono icono={IconoMas} tamano={20} />
              Nuevo grupo
            </Link>
          }
        >
          Un grupo reúne las opciones que se eligen al pedir un plato, como el término de la carne o
          los extras. Crea el primero y agrégalo a tus productos.
        </EstadoVacio>
      ) : (
        <>
          {todos.length > GRUPOS_PARA_BUSCAR ? (
            <div className="carta__herramientas">
              <CampoTexto
                className="carta__busqueda"
                etiqueta="Buscar"
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Nombre del grupo"
                autoComplete="off"
              />
            </div>
          ) : null}
          <div className="carta__resumen">
            <p className="texto-ayuda" aria-live="polite">
              {todos.length === 1 ? '1 grupo' : `${todos.length} grupos`}
              {inactivos > 0
                ? ` · ${inactivos === 1 ? '1 inactivo' : `${inactivos} inactivos`}`
                : ''}
            </p>
            {inactivos > 0 ? (
              <Boton
                variante="texto"
                aria-pressed={verInactivos}
                onClick={() => setVerInactivos((v) => !v)}
              >
                {verInactivos ? 'Ocultar inactivos' : 'Ver inactivos'}
              </Boton>
            ) : null}
          </div>

          {visibles.length === 0 ? (
            <EstadoVacio icono={IconoGrupo} titulo="No encontramos grupos">
              {texto !== ''
                ? 'Prueba con otro nombre.'
                : 'Todos los grupos están inactivos. Toca "Ver inactivos" para verlos.'}
            </EstadoVacio>
          ) : (
            <TablaResponsiva
              etiqueta="Grupos de modificadores"
              filas={visibles}
              clave={(g) => g.id}
              apagada={(g) => !g.activo}
              filaEnLista={(g) => (
                <Link to={`/carta/grupos/${g.id}`} className={claseFila(!g.activo)}>
                  <ContenidoDeFila
                    apagada={!g.activo}
                    titulo={g.nombre}
                    ayuda={ayudaDe(g)}
                    derecha={
                      <>
                        {g.activo ? null : (
                          <EtiquetaDeEstado tono="neutro">Inactivo</EtiquetaDeEstado>
                        )}
                        <Icono icono={IconoDerecha} />
                      </>
                    }
                    extra={
                      <span className="texto-ayuda">{usoEnProductos(g.productos.length)}</span>
                    }
                  />
                </Link>
              )}
              columnas={[
                {
                  id: 'nombre',
                  encabezado: 'Grupo',
                  celda: (g) => (
                    <Link to={`/carta/grupos/${g.id}`} className="enlace-texto enlace-nombre">
                      {g.nombre}
                    </Link>
                  ),
                },
                { id: 'regla', encabezado: 'Regla', celda: (g) => reglaDeRespuesta(g) },
                {
                  id: 'opciones',
                  encabezado: 'Opciones',
                  alinear: 'derecha',
                  sinSaltos: true,
                  celda: (g) => g.modificadores.length,
                },
                {
                  id: 'productos',
                  encabezado: 'Productos que lo usan',
                  alinear: 'derecha',
                  sinSaltos: true,
                  celda: (g) => g.productos.length,
                },
                {
                  id: 'estado',
                  encabezado: 'Estado',
                  celda: (g) =>
                    g.activo ? null : <EtiquetaDeEstado tono="neutro">Inactivo</EtiquetaDeEstado>,
                },
                {
                  id: 'acciones',
                  encabezado: 'Acciones',
                  encabezadoOculto: true,
                  alinear: 'derecha',
                  sinSaltos: true,
                  celda: (g) => (
                    <Link to={`/carta/grupos/${g.id}`} className={claseBoton()}>
                      Editar <span className="ui-solo-lectores">{g.nombre}</span>
                    </Link>
                  ),
                },
              ]}
            />
          )}
        </>
      )}
    </MarcoDeCarta>
  );
}
