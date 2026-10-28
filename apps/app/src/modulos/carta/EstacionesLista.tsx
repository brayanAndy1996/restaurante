import { IconoEstacion } from '@restaurante/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { usePermiso } from '../acceso/permisos';
import {
  CLAVES,
  crearEstacion,
  listarEstaciones,
  modificarEstacion,
  pluralProductos,
} from './carta';
import { ListaDeCatalogo, type TextosDeCatalogo } from './ListaDeCatalogo';

const TEXTOS: TextosDeCatalogo = {
  singular: 'estación',
  agregar: 'Agregar estación',
  campo: 'Nombre de la estación',
  maximo: 50,
  ejemplo: 'Por ejemplo, Cocina',
  cargando: 'Cargando estaciones',
  errorDeCarga: 'No pudimos cargar las estaciones',
  vacioTitulo: 'Aún no hay estaciones',
  vacioTexto:
    'Crea los lugares donde se prepara lo que vendes, por ejemplo Cocina, Barra o Parrilla. Cada producto va a una estación, o a ninguna.',
  lista: 'Estaciones',
  resumen: (total, inactivos) =>
    `${total === 1 ? '1 estación' : `${total} estaciones`}${
      inactivos > 0 ? ` · ${inactivos === 1 ? '1 inactiva' : `${inactivos} inactivas`}` : ''
    }`,
  cuenta: pluralProductos,
  enUso: (n) =>
    `${n === 1 ? 'Esta estación la usa 1 producto' : `Esta estación la usan ${n} productos`}. Cámbialos de estación antes de desactivarla.`,
  repetido: 'Ya tienes una estación con ese nombre. Usa otro.',
  inactiva: 'Inactiva',
  icono: IconoEstacion,
};

/**
 * Estaciones de producción (criterios 1, 2, 2b y 75): solo el Administrador las define. Quien no tiene
 * `ADMINISTRAR` ni ve la sección; si llega por la dirección, vuelve a "Productos".
 */
export function EstacionesLista() {
  const puedeAdministrar = usePermiso('ADMINISTRAR') === 'permitido';
  const clientes = useQueryClient();
  const consulta = useQuery({
    queryKey: CLAVES.estaciones,
    queryFn: ({ signal }) => listarEstaciones(signal),
    enabled: puedeAdministrar,
  });
  const items = useMemo(
    () =>
      consulta.data?.map((e) => ({
        id: e.id,
        nombre: e.nombre,
        activa: e.activa,
        cuenta: e.productosActivos,
      })),
    [consulta.data],
  );
  const refrescar = () => clientes.invalidateQueries({ queryKey: CLAVES.todo });
  const crear = useMutation({ mutationFn: crearEstacion, onSuccess: refrescar });
  const modificar = useMutation({
    mutationFn: (datos: { id: string; cambios: { nombre?: string; activa?: boolean } }) =>
      modificarEstacion(datos.id, datos.cambios),
    onSuccess: refrescar,
  });
  if (!puedeAdministrar) return <Navigate to="/carta?ver=productos" replace />;
  return (
    <ListaDeCatalogo
      seccion="estaciones"
      textos={TEXTOS}
      items={items}
      cargando={consulta.isPending}
      error={consulta.isError ? consulta.error : null}
      reintentando={consulta.isFetching}
      onReintentar={() => void consulta.refetch()}
      onCrear={(nombre) => crear.mutateAsync(nombre)}
      onModificar={(id, cambios) => modificar.mutateAsync({ id, cambios })}
    />
  );
}
