import type { GrupoRespuesta } from '@restaurante/contratos';
import {
  Aviso,
  Boton,
  DialogoConfirmacion,
  ErrorDeCarga,
  EsqueletoDeLista,
  EtiquetaDeEstado,
} from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { CLAVES, modificarGrupo, obtenerGrupo } from './carta';
import { GrupoFormulario } from './GrupoFormulario';
import { listaEnFrase, productosEnUso, reglaDeRespuesta } from './grupo-form';
import { useFormularioDeGrupo } from './useFormularioDeGrupo';

const ID_FORMULARIO = 'formulario-grupo';
const ATRAS = { a: '/carta?ver=modificadores', etiqueta: 'Modificadores' } as const;

/** Alta de un grupo de modificadores. */
export function GrupoNuevoPagina() {
  return <FormularioDeGrupoPagina />;
}

/** Edición de un grupo existente: lo carga y muestra el mismo formulario. */
export function GrupoEditarPagina() {
  const { id = '' } = useParams();
  const grupo = useQuery({
    queryKey: CLAVES.grupo(id),
    queryFn: ({ signal }) => obtenerGrupo(id, signal),
  });

  if (grupo.isPending) {
    return (
      <Pagina titulo="Grupo" atras={ATRAS}>
        <EsqueletoDeLista filas={3} conInicial={false} etiqueta="Cargando el grupo" />
      </Pagina>
    );
  }
  if (grupo.isError) {
    const noExiste = grupo.error instanceof ErrorApi && grupo.error.codigo === 'NO_ENCONTRADO';
    const sinRed = grupo.error instanceof ErrorApi && grupo.error.sinConexion;
    return (
      <Pagina titulo="Grupo" atras={ATRAS}>
        <ErrorDeCarga
          titulo={
            noExiste
              ? 'No encontramos este grupo'
              : sinRed
                ? 'Sin conexión'
                : 'No pudimos cargar el grupo'
          }
          onReintentar={() => void grupo.refetch()}
          reintentando={grupo.isFetching}
        >
          {noExiste
            ? 'Puede que ya no exista. Vuelve a la lista de grupos.'
            : mensajeDeError(grupo.error)}
        </ErrorDeCarga>
      </Pagina>
    );
  }
  return <FormularioDeGrupoPagina key={grupo.data.id} original={grupo.data} />;
}

function FormularioDeGrupoPagina({ original }: { original?: GrupoRespuesta }) {
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const recienCreado = Boolean((ubicacion.state as { creado?: boolean } | null)?.creado);

  const f = useFormularioDeGrupo(original, (grupo, creado) => {
    if (creado) navegar(`/carta/grupos/${grupo.id}`, { replace: true, state: { creado: true } });
  });

  const titulo = original ? original.nombre : 'Nuevo grupo';
  return (
    <Pagina
      titulo={titulo}
      atras={ATRAS}
      pie={
        <Boton
          variante="principal"
          bloque
          type="submit"
          form={ID_FORMULARIO}
          cargando={f.enviando}
          textoCargando="Guardando…"
          disabled={f.sinCambios}
        >
          {original ? 'Guardar cambios' : 'Crear grupo'}
        </Boton>
      }
    >
      {original ? (
        <div className="etiquetas">
          <EtiquetaDeEstado tono="neutro">{reglaDeRespuesta(original)}</EtiquetaDeEstado>
          {!original.activo ? <EtiquetaDeEstado tono="neutro">Inactivo</EtiquetaDeEstado> : null}
        </div>
      ) : null}
      {recienCreado && original ? (
        <Aviso tipo="ok" titulo="Grupo creado">
          <p>Agrégalo a un producto desde su pantalla, en la sección Modificadores.</p>
          <p className="carta__enlaces">
            <Link to="/carta/grupos/nuevo" className="enlace-texto">
              Crear otro grupo
            </Link>
            <Link to={ATRAS.a} className="enlace-texto">
              Volver a los grupos
            </Link>
          </p>
        </Aviso>
      ) : null}

      <GrupoFormulario f={f} original={original} idFormulario={ID_FORMULARIO} />

      {original ? <EstadoDelGrupo grupo={original} /> : null}
    </Pagina>
  );
}

/**
 * Desactivar y reactivar (criterio 29). Un grupo en uso no se puede desactivar: la API responde `EN_USO`
 * y aquí se explica con los productos que lo usan, con enlace a cada uno, para quitarlo de ahí.
 */
function EstadoDelGrupo({ grupo }: { grupo: GrupoRespuesta }) {
  const clientes = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [enUso, setEnUso] = useState<{ id: string; nombre: string }[] | null>(null);

  async function cambiarActivo(activo: boolean) {
    setCambiando(true);
    setFallo(null);
    setEnUso(null);
    try {
      const actualizado = await modificarGrupo(grupo.id, { activo });
      clientes.setQueryData(CLAVES.grupo(grupo.id), actualizado);
      void clientes.invalidateQueries({ queryKey: CLAVES.grupos });
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'EN_USO') {
        // Se vuelve a pedir el grupo: los productos que lo usan pudieron cambiar desde que se abrió.
        void clientes.invalidateQueries({ queryKey: CLAVES.grupo(grupo.id) });
        setEnUso(productosEnUso(e, grupo));
      } else {
        setFallo(
          mensajeDeError(e, {
            PROHIBIDO: 'No tienes permiso para cambiar los grupos de modificadores.',
            REFERENCIA_INVALIDA:
              'Una opción de este grupo está ligada a un producto que ya no puede usarse. Cambia o quita ese producto en la opción antes de reactivarlo.',
          }),
        );
      }
    } finally {
      setCambiando(false);
      setConfirmando(false);
    }
  }

  return (
    <section className="formulario__aparte" aria-labelledby="grupo-estado">
      <h2 className="formulario__titulo" id="grupo-estado">
        {grupo.activo ? 'Desactivar' : 'Reactivar'}
      </h2>

      {enUso ? (
        <Aviso tipo="error" titulo="No se puede desactivar este grupo">
          <p>
            Lo usan {enUso.length === 1 ? 'este producto' : 'estos productos'}:{' '}
            {listaEnFrase(enUso.map((p) => p.nombre))}. Quítalo de{' '}
            {enUso.length === 1 ? 'ahí' : 'cada uno'} y vuelve a intentar.
          </p>
          <ul className="carta__usos">
            {enUso.map((p) => (
              <li key={p.id}>
                <Link to={`/carta/productos/${p.id}`} className="enlace-texto">
                  {p.nombre}
                </Link>
              </li>
            ))}
          </ul>
        </Aviso>
      ) : null}
      {fallo ? (
        <Aviso tipo="error" titulo="No pudimos hacer el cambio">
          {fallo}
        </Aviso>
      ) : null}

      {grupo.activo ? (
        <>
          <p className="texto-ayuda">
            Deja de poder agregarse a productos. No se borra: las ventas ya hechas lo conservan y
            puedes reactivarlo. Si lo usan productos, primero quítalo de ellos.
          </p>
          <Boton variante="peligro" bloque onClick={() => setConfirmando(true)}>
            Desactivar grupo
          </Boton>
        </>
      ) : (
        <>
          <p className="texto-ayuda">
            No se puede agregar a productos. Al reactivarlo vuelve a estar disponible.
          </p>
          <Boton
            bloque
            cargando={cambiando}
            textoCargando="Reactivando…"
            onClick={() => void cambiarActivo(true)}
          >
            Reactivar grupo
          </Boton>
        </>
      )}

      <DialogoConfirmacion
        abierta={confirmando}
        titulo={`¿Desactivar «${grupo.nombre}»?`}
        etiquetaConfirmar="Desactivar grupo"
        textoCargando="Desactivando…"
        peligro
        cargando={cambiando}
        onConfirmar={() => void cambiarActivo(false)}
        onCancelar={() => setConfirmando(false)}
      >
        <p>
          Dejará de poder agregarse a productos. Podrás reactivarlo cuando quieras. Si lo usa algún
          producto, no se podrá desactivar hasta que lo quites de ahí.
        </p>
      </DialogoConfirmacion>
    </section>
  );
}
