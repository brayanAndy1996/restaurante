import type { GrupoRespuesta } from '@restaurante/contratos';
import { moverEnLista } from '@restaurante/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useEnvioPendiente } from '../../lib/envios';
import { CLAVES, crearGrupo, modificarGrupo } from './carta';
import {
  cambiosDelGrupo,
  entradaDeGrupo,
  falloDeGrupo,
  formularioDeGrupo,
  grupoVacio,
  hayCambiosDeGrupo,
  hayErrores,
  opcionVacia,
  validarGrupo,
  MAXIMO_OPCIONES,
  type EstadoDelGrupo,
  type ErroresDelGrupo,
  type OpcionEditable,
} from './grupo-form';

const SIN_ERRORES: ErroresDelGrupo = { porOpcion: {} };

export interface FormularioDeGrupo {
  estado: EstadoDelGrupo;
  errores: ErroresDelGrupo;
  fallo: string | null;
  enviando: boolean;
  /** El envío espera la red: se dice "Pendiente de envío" y sale solo al volver (criterio 78). */
  pendiente: boolean;
  guardado: boolean;
  /** Editando y sin tocar nada: no hay nada que guardar. */
  sinCambios: boolean;
  modo: 'crear' | 'editar';
  /** Opción cuyo nombre debe recibir el foco (la que se acaba de agregar). */
  clavePorEnfocar: string | null;
  cambiar: (parcial: Partial<EstadoDelGrupo>) => void;
  cambiarOpcion: (clave: string, parcial: Partial<OpcionEditable>) => void;
  agregarOpcion: () => void;
  quitarOpcion: (clave: string) => void;
  moverOpcion: (desde: number, hacia: number) => void;
  enviar: (evento?: FormEvent) => Promise<void>;
}

/**
 * Lo que tienen en común el formulario del grupo en su pantalla y el que se abre dentro de un producto:
 * lo escrito (que no se pierde por un corte, vive en la pantalla), la validación campo por campo, el
 * envío con clave de idempotencia (el alta) y los errores de la API llevados a su campo (003, criterios
 * 24 a 27 y 78).
 */
export function useFormularioDeGrupo(
  original: GrupoRespuesta | undefined,
  alGuardar: (grupo: GrupoRespuesta, creado: boolean) => void,
): FormularioDeGrupo {
  const clientes = useQueryClient();
  const envio = useEnvioPendiente();
  const modo = original ? 'editar' : 'crear';
  const [estado, setEstado] = useState<EstadoDelGrupo>(() =>
    original ? formularioDeGrupo(original) : grupoVacio(),
  );
  const [errores, setErrores] = useState<ErroresDelGrupo>(SIN_ERRORES);
  const [fallo, setFallo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [clavePorEnfocar, setClavePorEnfocar] = useState<string | null>(null);

  const cambios = original ? cambiosDelGrupo(original, estado) : {};
  const sinCambios = modo === 'editar' && !hayCambiosDeGrupo(cambios);

  function tocar() {
    setGuardado(false);
    setFallo(null);
  }

  function cambiar(parcial: Partial<EstadoDelGrupo>) {
    setEstado((e) => ({ ...e, ...parcial }));
    tocar();
    // Lo que se vuelve a escribir deja de marcarse como erróneo hasta el próximo envío.
    setErrores((previos) => {
      const siguientes = { ...previos };
      if ('nombre' in parcial) delete siguientes.nombre;
      if ('minimo' in parcial || 'seleccion' in parcial) delete siguientes.minimo;
      if ('maximo' in parcial || 'seleccion' in parcial) delete siguientes.maximo;
      return siguientes;
    });
  }

  function cambiarOpcion(clave: string, parcial: Partial<OpcionEditable>) {
    setEstado((e) => ({
      ...e,
      opciones: e.opciones.map((o) => (o.clave === clave ? { ...o, ...parcial } : o)),
    }));
    tocar();
    setErrores((previos) => {
      const { opciones: _quitado, ...base } = previos;
      const deLaOpcion = previos.porOpcion[clave];
      if (!deLaOpcion) return { ...base, porOpcion: previos.porOpcion };
      const { nombre, precioExtra, producto } = deLaOpcion;
      const restante = {
        ...(nombre !== undefined && !('nombre' in parcial) ? { nombre } : {}),
        ...(precioExtra !== undefined && !('precioExtra' in parcial) ? { precioExtra } : {}),
        ...(producto !== undefined && !('productoId' in parcial) ? { producto } : {}),
      };
      return { ...base, porOpcion: { ...previos.porOpcion, [clave]: restante } };
    });
  }

  function agregarOpcion() {
    if (estado.opciones.length >= MAXIMO_OPCIONES) return;
    const nueva = opcionVacia();
    setEstado((e) => ({ ...e, opciones: [...e.opciones, nueva] }));
    setClavePorEnfocar(nueva.clave);
    setErrores((previos) => {
      const { opciones: _quitado, ...resto } = previos;
      return resto as ErroresDelGrupo;
    });
    tocar();
  }

  function quitarOpcion(clave: string) {
    setEstado((e) => ({ ...e, opciones: e.opciones.filter((o) => o.clave !== clave) }));
    setClavePorEnfocar(null);
    tocar();
  }

  function moverOpcion(desde: number, hacia: number) {
    setEstado((e) => ({ ...e, opciones: moverEnLista(e.opciones, desde, hacia) }));
    setClavePorEnfocar(null);
    tocar();
  }

  async function enviar(evento?: FormEvent) {
    evento?.preventDefault();
    if (enviando) return;
    const nuevos = validarGrupo(estado);
    setErrores(nuevos);
    setFallo(null);
    if (hayErrores(nuevos)) {
      setFallo('Revisa los datos marcados e inténtalo de nuevo.');
      return;
    }
    if (original && !hayCambiosDeGrupo(cambios)) return;

    setEnviando(true);
    try {
      const respuesta = original
        ? await envio.enviar((extra) => modificarGrupo(original.id, cambios, extra))
        : await envio.enviar((extra) => crearGrupo(entradaDeGrupo(estado), extra));
      clientes.setQueryData(CLAVES.grupo(respuesta.id), respuesta);
      void clientes.invalidateQueries({ queryKey: CLAVES.grupos });
      // Los productos muestran los nombres de sus grupos y cuántos productos usa cada uno.
      void clientes.invalidateQueries({ queryKey: CLAVES.productos });
      setEstado(formularioDeGrupo(respuesta));
      setGuardado(true);
      alGuardar(respuesta, original === undefined);
    } catch (e) {
      const dicho = falloDeGrupo(e, estado, modo);
      setErrores(dicho.errores);
      setFallo(dicho.mensaje);
    } finally {
      setEnviando(false);
    }
  }

  return {
    estado,
    errores,
    fallo,
    enviando,
    pendiente: envio.pendiente,
    guardado,
    sinCambios,
    modo,
    clavePorEnfocar,
    cambiar,
    cambiarOpcion,
    agregarOpcion,
    quitarOpcion,
    moverOpcion,
    enviar,
  };
}
