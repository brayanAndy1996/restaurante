import type { GrupoRespuesta } from '@restaurante/contratos';
import type { TipoProducto } from '@restaurante/dominio';
import {
  Aviso,
  Boton,
  ContenidoDeFila,
  ErrorDeCarga,
  EsqueletoDeLista,
  FilaOrdenable,
  IconoMas,
  moverEnLista,
} from '@restaurante/ui';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ErrorApi, mensajeDeError } from '../../lib/errores';
import { CLAVES, listarGrupos } from './carta';
import { GrupoFormulario } from './GrupoFormulario';
import { MAXIMO_GRUPOS_POR_PRODUCTO, pluralOpciones, reglaDeRespuesta } from './grupo-form';
import type { GrupoDeProducto } from './producto-form';
import { useFormularioDeGrupo } from './useFormularioDeGrupo';

type Panel = { tipo: 'crear' } | { tipo: 'editar'; grupo: GrupoRespuesta };

/** Cómo se llama la sección y qué explica según el tipo del producto (un menú del día usa un grupo por tiempo). */
const TEXTOS_POR_TIPO: Record<TipoProducto, { titulo: string; ayuda: string; vacio: string }> = {
  SIMPLE: {
    titulo: 'Modificadores',
    ayuda:
      'Las opciones que se eligen al pedir este producto, como el término de la carne o los extras. Un grupo se puede usar en varios productos.',
    vacio: 'Este producto no tiene grupos. Agrega uno o crea uno nuevo.',
  },
  COMBO: {
    titulo: 'Grupos de opciones',
    ayuda:
      'Lo que elige el cliente dentro del combo, como la bebida o el acompañamiento. Cada opción puede sumar un monto al precio. Un grupo se puede usar en varios productos.',
    vacio: 'Este combo no tiene grupos de opciones. Agrega uno o crea uno nuevo.',
  },
  MENU_DEL_DIA: {
    titulo: 'Tiempos del menú',
    ayuda:
      'Un grupo por tiempo, como Entrada o Segundo. Sus opciones son los platos candidatos; cada día se elige cuáles se ofrecen en Disponibilidad. Un grupo se puede usar en varios productos.',
    vacio: 'Este menú no tiene tiempos. Agrega un grupo por cada tiempo (Entrada, Segundo…) o crea uno nuevo.',
  },
};

interface Props {
  /** El producto que se edita; sin él (alta), todos los productos que usan un grupo son "otros". */
  productoId?: string | undefined;
  valor: GrupoDeProducto[];
  onCambio: (grupos: GrupoDeProducto[]) => void;
  error?: string | undefined;
  /** Tipo del producto: cambia el título y la explicación. Por defecto, simple. */
  tipo?: TipoProducto;
}

/** "También lo usan 2 productos más". */
function otrosProductos(
  grupo: GrupoRespuesta | undefined,
  productoId: string | undefined,
): string | null {
  if (!grupo) return null;
  const otros = grupo.productos.filter((p) => p.id !== productoId).length;
  if (otros === 0) return null;
  return otros === 1 ? 'También lo usa 1 producto más' : `También lo usan ${otros} productos más`;
}

/**
 * Los grupos de modificadores de un producto (003, criterios 6, 28 y 72): elegir de los que ya existen,
 * ordenarlos, quitarlos, y crear o editar uno sin salir del producto. Un grupo es de todos los productos
 * que lo usan: al editarlo se avisa. Lo elegido aquí se guarda con el producto ("Guardar cambios").
 */
export function GruposDelProducto({
  productoId,
  valor,
  onCambio,
  error,
  tipo = 'SIMPLE',
}: Props) {
  const textos = TEXTOS_POR_TIPO[tipo];
  const idBase = useId();
  const grupos = useQuery({
    queryKey: CLAVES.grupos,
    queryFn: ({ signal }) => listarGrupos(signal),
  });
  const [eligiendo, setEligiendo] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const porId = new Map((grupos.data ?? []).map((g) => [g.id, g]));
  const asignados = new Set(valor.map((g) => g.id));
  const disponibles = (grupos.data ?? []).filter((g) => g.activo && !asignados.has(g.id));
  const lleno = valor.length >= MAXIMO_GRUPOS_POR_PRODUCTO;

  function agregar(grupo: GrupoRespuesta) {
    onCambio([...valor, { id: grupo.id, nombre: grupo.nombre }]);
    setEligiendo(false);
    setAviso(`«${grupo.nombre}» agregado. Se guarda con el producto.`);
  }

  function quitar(grupo: GrupoDeProducto) {
    onCambio(valor.filter((g) => g.id !== grupo.id));
    setAviso(`«${grupo.nombre}» quitado de este producto. El grupo sigue existiendo.`);
  }

  function alGuardarGrupo(grupo: GrupoRespuesta, creado: boolean) {
    setPanel(null);
    if (creado) {
      onCambio([...valor, { id: grupo.id, nombre: grupo.nombre }]);
      setAviso(
        `Grupo «${grupo.nombre}» creado y agregado a este producto. Falta guardar el producto para que lo use.`,
      );
    } else {
      onCambio(valor.map((g) => (g.id === grupo.id ? { id: g.id, nombre: grupo.nombre } : g)));
      setAviso(
        grupo.productos.length > 1
          ? `Grupo «${grupo.nombre}» guardado. Ya vale para sus ${grupo.productos.length} productos.`
          : `Grupo «${grupo.nombre}» guardado.`,
      );
    }
  }

  return (
    <section className="seccion" aria-labelledby={`${idBase}-titulo`}>
      <h2 className="formulario__titulo" id={`${idBase}-titulo`}>
        {textos.titulo}
      </h2>
      <p className="texto-ayuda">{textos.ayuda}</p>

      {error ? (
        <Aviso tipo="error" titulo="Revisa los grupos">
          {error}
        </Aviso>
      ) : null}
      {aviso ? (
        <Aviso tipo="ok" titulo="Listo">
          {aviso}
        </Aviso>
      ) : null}

      {valor.length === 0 ? (
        <p className="grupos__vacio">{textos.vacio}</p>
      ) : (
        <ul className="ui-lista" aria-label="Grupos de este producto">
          {valor.map((g, i) => {
            const conocido = porId.get(g.id);
            const otros = otrosProductos(conocido, productoId);
            return (
              <FilaOrdenable
                key={g.id}
                nombre={g.nombre}
                posicion={i + 1}
                total={valor.length}
                onSubir={() => onCambio(moverEnLista(valor, i, i - 1))}
                onBajar={() => onCambio(moverEnLista(valor, i, i + 1))}
              >
                <div className="ui-fila">
                  <ContenidoDeFila
                    titulo={g.nombre}
                    ayuda={
                      conocido
                        ? `${reglaDeRespuesta(conocido)} · ${pluralOpciones(conocido.modificadores.length)}`
                        : undefined
                    }
                    extra={
                      <span className="grupo__asignado-pie">
                        {otros ? <span className="texto-ayuda">{otros}</span> : null}
                        <span className="grupo__asignado-acciones">
                          {conocido ? (
                            <Boton
                              variante="texto"
                              aria-label={`Editar grupo ${g.nombre}`}
                              onClick={() => {
                                setPanel({ tipo: 'editar', grupo: conocido });
                                setEligiendo(false);
                                setAviso(null);
                              }}
                            >
                              Editar grupo
                            </Boton>
                          ) : null}
                          <Boton
                            variante="texto"
                            aria-label={`Quitar ${g.nombre}`}
                            onClick={() => quitar(g)}
                          >
                            Quitar
                          </Boton>
                        </span>
                      </span>
                    }
                  />
                </div>
              </FilaOrdenable>
            );
          })}
        </ul>
      )}

      {panel ? (
        <PanelDeGrupo
          key={panel.tipo === 'editar' ? panel.grupo.id : 'nuevo'}
          panel={panel}
          alGuardar={alGuardarGrupo}
          alCancelar={() => setPanel(null)}
        />
      ) : (
        <>
          {lleno ? (
            <p className="texto-ayuda">
              Un producto admite hasta {MAXIMO_GRUPOS_POR_PRODUCTO} grupos. Quita uno para agregar
              otro.
            </p>
          ) : null}
          <div className="fila-botones fila-botones--envuelta">
            <Boton
              aria-expanded={eligiendo}
              disabled={lleno || grupos.isPending}
              onClick={() => {
                setEligiendo((v) => !v);
                setAviso(null);
              }}
            >
              Agregar un grupo
            </Boton>
            <Boton
              icono={IconoMas}
              disabled={lleno}
              onClick={() => {
                setPanel({ tipo: 'crear' });
                setEligiendo(false);
                setAviso(null);
              }}
            >
              Crear un grupo nuevo
            </Boton>
          </div>
        </>
      )}

      {grupos.isPending ? (
        <EsqueletoDeLista filas={1} conInicial={false} etiqueta="Cargando los grupos" />
      ) : grupos.isError ? (
        <ErrorDeCarga
          titulo={
            grupos.error instanceof ErrorApi && grupos.error.sinConexion
              ? 'Sin conexión'
              : 'No pudimos cargar tus grupos'
          }
          onReintentar={() => void grupos.refetch()}
          reintentando={grupos.isFetching}
        >
          {mensajeDeError(grupos.error)}
        </ErrorDeCarga>
      ) : eligiendo && !panel ? (
        disponibles.length === 0 ? (
          <p className="grupos__vacio">
            {(grupos.data ?? []).filter((g) => g.activo).length === 0
              ? 'Aún no tienes grupos. Crea el primero con «Crear un grupo nuevo».'
              : 'Ya agregaste todos tus grupos a este producto.'}
          </p>
        ) : (
          <ul className="ui-lista" aria-label="Grupos que puedes agregar">
            {disponibles.map((g) => (
              <li key={g.id}>
                <div className="ui-fila">
                  <ContenidoDeFila
                    titulo={g.nombre}
                    ayuda={`${reglaDeRespuesta(g)} · ${pluralOpciones(g.modificadores.length)}`}
                    derecha={
                      <Boton aria-label={`Agregar ${g.nombre}`} onClick={() => agregar(g)}>
                        Agregar
                      </Boton>
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

/** El formulario del grupo dentro del producto: crea uno o edita uno asignado, sin salir de la pantalla. */
function PanelDeGrupo({
  panel,
  alGuardar,
  alCancelar,
}: {
  panel: Panel;
  alGuardar: (grupo: GrupoRespuesta, creado: boolean) => void;
  alCancelar: () => void;
}) {
  const original = panel.tipo === 'editar' ? panel.grupo : undefined;
  const f = useFormularioDeGrupo(original, alGuardar);
  const idTitulo = useId();
  return (
    <div className="grupo__panel" role="group" aria-labelledby={idTitulo}>
      <h3 className="grupo__panel-titulo" id={idTitulo}>
        {original ? `Editar «${original.nombre}»` : 'Nuevo grupo'}
      </h3>
      <GrupoFormulario
        f={f}
        original={original}
        idFormulario={`${idTitulo}-formulario`}
        integrado={{ alCancelar }}
      />
    </div>
  );
}
