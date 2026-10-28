import { IconoFamilia } from '@restaurante/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  CLAVES,
  crearFamilia,
  listarFamilias,
  modificarFamilia,
  ordenarFamilias,
  pluralProductos,
} from './carta';
import { ListaDeCatalogo, type TextosDeCatalogo } from './ListaDeCatalogo';

const TEXTOS: TextosDeCatalogo = {
  singular: 'familia',
  agregar: 'Agregar familia',
  campo: 'Nombre de la familia',
  maximo: 60,
  ejemplo: 'Por ejemplo, Entradas',
  cargando: 'Cargando familias',
  errorDeCarga: 'No pudimos cargar las familias',
  vacioTitulo: 'Aún no hay familias',
  vacioTexto:
    'Crea la primera, por ejemplo Entradas, Fondos o Bebidas. Cada producto va en una familia.',
  lista: 'Familias',
  resumen: (total, inactivos) =>
    `${total === 1 ? '1 familia' : `${total} familias`}${
      inactivos > 0 ? ` · ${inactivos === 1 ? '1 inactiva' : `${inactivos} inactivas`}` : ''
    }`,
  cuenta: pluralProductos,
  enUso: (n) =>
    `Esta familia tiene ${n === 1 ? '1 producto activo' : `${n} productos activos`}. Pásalos a otra familia o desactívalos antes de desactivarla.`,
  repetido: 'Ya tienes una familia con ese nombre. Usa otro.',
  inactiva: 'Inactiva',
  icono: IconoFamilia,
};

/** Familias de la carta (criterios 3 a 5 y 75): lista en su orden, agregar, renombrar, desactivar y ordenar. */
export function FamiliasLista() {
  const clientes = useQueryClient();
  const consulta = useQuery({
    queryKey: CLAVES.familias,
    queryFn: ({ signal }) => listarFamilias(signal),
  });
  const items = useMemo(
    () =>
      consulta.data?.map((f) => ({
        id: f.id,
        nombre: f.nombre,
        activa: f.activa,
        cuenta: f.productos,
      })),
    [consulta.data],
  );
  // Una familia nueva, renombrada o desactivada cambia también la lista de productos (agrupada por familia).
  const refrescar = () => clientes.invalidateQueries({ queryKey: CLAVES.todo });
  const crear = useMutation({ mutationFn: crearFamilia, onSuccess: refrescar });
  const modificar = useMutation({
    mutationFn: (datos: { id: string; cambios: { nombre?: string; activa?: boolean } }) =>
      modificarFamilia(datos.id, datos.cambios),
    onSuccess: refrescar,
  });
  const ordenar = useMutation({
    mutationFn: ordenarFamilias,
    onSuccess: (lista) => {
      clientes.setQueryData(CLAVES.familias, lista);
      return clientes.invalidateQueries({ queryKey: CLAVES.productos });
    },
  });
  return (
    <ListaDeCatalogo
      seccion="familias"
      textos={TEXTOS}
      items={items}
      cargando={consulta.isPending}
      error={consulta.isError ? consulta.error : null}
      reintentando={consulta.isFetching}
      onReintentar={() => void consulta.refetch()}
      onCrear={(nombre) => crear.mutateAsync(nombre)}
      onModificar={(id, cambios) => modificar.mutateAsync({ id, cambios })}
      onOrdenar={(ids) => ordenar.mutateAsync(ids)}
    />
  );
}
