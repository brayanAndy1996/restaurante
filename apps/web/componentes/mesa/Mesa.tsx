'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DisponibilidadPublica, LlamadoEntrada, MesaPublica } from '@restaurante/contratos';
// Entrada `llamados` del dominio: sin `decimal.js`, para no sumar peso a la primera carga del modo mesa.
import { MAXIMO_LINEAS_LLAMADO } from '@restaurante/dominio/llamados';
import { ErrorApi } from '@/lib/api';
import { EVENTO_DISPONIBILIDAD } from '@/lib/disponibilidad';
import {
  AVISO_LOCAL_CERRADO,
  AVISO_SIN_CONEXION,
  ESPERAS_REINTENTO_MS,
  INTERVALO_ESTADO_MS,
  REINTENTOS_DE_SERVIDOR,
  avisoDeError,
  avisoDeEstado,
  esReintentable,
  consultarEstado,
  consultarMesa,
  enviarLlamado,
  rechazosDeLineas,
  type AvisoDeMesa,
} from '@/lib/llamados';
import {
  LLAMADO_VACIO,
  PEDIDO_VACIO,
  cuerpoDelPedido,
  guardarLlamado,
  guardarPedido,
  indiceDeDisponibilidad,
  leerLlamado,
  leerPedido,
  mismoCuerpo,
  nuevoId,
  platosDelPedido,
  quitarLinea,
  reemplazarLinea,
  type LlamadoGuardado,
  type PedidoGuardado,
  type ProductoMesa,
} from '@/lib/pedido';
import { Aviso } from './Aviso';
import { BarraDeMesa } from './BarraDeMesa';
import { HojaDeConfirmar } from './HojaDeConfirmar';
import { cargarPerezoso, type BloquePerezoso } from './cargar-perezoso';

type HojaAbierta =
  | null
  | { tipo: 'producto'; productoId: string; clave: string | null; desdePedido: boolean }
  | { tipo: 'pedido' }
  | { tipo: 'confirmar'; cual: 'llamar' | 'cuenta' };

interface Props {
  /** Código de la mesa (el de la dirección): la clave del pedido guardado. */
  codigo: string;
  /** "Mesa 4": como se la nombra al cliente. */
  mesa: string;
  /** La carta del servidor: lo que la hoja de producto necesita de cada producto. */
  productos: ProductoMesa[];
  aceptaLlamados: boolean;
  llamadoPendiente: MesaPublica['llamadoPendiente'];
}

const SIN_NO_DISPONIBLES: ReadonlySet<string> = new Set();

/**
 * La isla del modo mesa (criterios 82 y 84 a 87): arma el pedido, lo envía al mozo con el mismo `id` hasta tener una
 * respuesta final, y muestra el estado del llamado. Dibuja la barra fija y las hojas; los productos de la carta los
 * pinta el servidor, y esta isla solo escucha sus toques y les pone "N en tu pedido".
 *
 * Reglas que cumple:
 * - el pedido vive en `sessionStorage` por código y sobrevive a una recarga;
 * - el `id` del llamado se genera al pulsar "Enviar" y se conserva hasta una respuesta final (201 o 4xx); sin red
 *   se reintenta con el mismo `id` (1, 2, 5 y 10 segundos), así el mozo no recibe dos veces lo mismo;
 * - con un llamado pendiente, los tres envíos quedan apagados; su estado se consulta cada 10 segundos.
 */
export function Mesa({ codigo, mesa, productos, aceptaLlamados, llamadoPendiente }: Props) {
  const mapa = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const nombreDeOpcion = useCallback(
    (id: string) => {
      for (const p of productos) {
        for (const g of p.grupos) {
          const m = g.modificadores.find((o) => o.id === id);
          if (m) return m.nombre;
        }
      }
      return undefined;
    },
    [productos],
  );

  const [pedido, setPedido] = useState<PedidoGuardado>(PEDIDO_VACIO);
  // Un llamado que la mesa ya tiene pendiente se dice desde la primera pintura (el servidor lo sabe).
  const [llamado, setLlamado] = useState<LlamadoGuardado>(() =>
    llamadoPendiente
      ? { envio: null, seguimiento: { id: null, ...llamadoPendiente, estado: 'PENDIENTE' } }
      : LLAMADO_VACIO,
  );
  const [cargado, setCargado] = useState(false);
  const [hoja, setHoja] = useState<HojaAbierta>(null);
  const [aviso, setAviso] = useState<AvisoDeMesa | null>(null);
  const [acepta, setAcepta] = useState(aceptaLlamados);
  /** Un 5xx que se agotó: el envío espera a que el cliente vuelva a pulsar. */
  const [pausado, setPausado] = useState(false);
  const [reintento, setReintento] = useState(0);
  const barra = useRef<HTMLDivElement>(null);

  // Las hojas y las reglas de montos (`decimal.js`) se descargan aparte (criterio 88): al primer toque en la página,
  // al volver con un pedido guardado o al abrir una hoja. Mientras tanto no hay montos que mostrar.
  const [perezoso, setPerezoso] = useState<BloquePerezoso | null>(null);
  const [falloLaCarga, setFalloLaCarga] = useState(false);
  const pedirPerezoso = useCallback(() => {
    cargarPerezoso().then(setPerezoso, () => setFalloLaCarga(true));
  }, []);
  useEffect(() => {
    const alInteractuar = () => pedirPerezoso();
    const opciones = { once: true, passive: true } as const;
    document.addEventListener('pointerdown', alInteractuar, opciones);
    document.addEventListener('scroll', alInteractuar, opciones);
    document.addEventListener('keydown', alInteractuar, opciones);
    return () => {
      document.removeEventListener('pointerdown', alInteractuar);
      document.removeEventListener('scroll', alInteractuar);
      document.removeEventListener('keydown', alInteractuar);
    };
  }, [pedirPerezoso]);

  // Lo último que dijo la isla de disponibilidad (criterio 82), para marcar "Se agotó" en el pedido.
  const [disponibilidad, setDisponibilidad] = useState<DisponibilidadPublica | null>(null);
  useEffect(() => {
    const alLlegar = (evento: Event) =>
      setDisponibilidad((evento as CustomEvent<DisponibilidadPublica>).detail);
    document.addEventListener(EVENTO_DISPONIBILIDAD, alLlegar);
    return () => document.removeEventListener(EVENTO_DISPONIBILIDAD, alLlegar);
  }, []);
  const disponibles = useMemo(() => indiceDeDisponibilidad(disponibilidad), [disponibilidad]);

  // --- Lo guardado en el navegador (solo existe en el cliente: se lee después de montar) ---
  const pendienteDelServidor = useRef(llamadoPendiente);
  useEffect(() => {
    const guardado = leerLlamado(codigo);
    const delServidor = pendienteDelServidor.current;
    const seguimiento =
      delServidor && guardado.seguimiento?.estado !== 'PENDIENTE'
        ? {
            id: null,
            tipo: delServidor.tipo,
            estado: 'PENDIENTE' as const,
            venceEn: delServidor.venceEn,
          }
        : guardado.seguimiento;
    setPedido(leerPedido(codigo));
    setLlamado({ envio: guardado.envio, seguimiento });
    setCargado(true);
  }, [codigo]);
  useEffect(() => {
    if (cargado) guardarPedido(codigo, pedido);
  }, [codigo, pedido, cargado]);
  useEffect(() => {
    if (cargado) guardarLlamado(codigo, llamado);
  }, [codigo, llamado, cargado]);

  const seguimiento = llamado.seguimiento;
  const envio = llamado.envio;
  const pendiente = seguimiento?.estado === 'PENDIENTE';

  // --- Problemas de cada línea ("Se agotó", "Ya no se vende"…) ---
  const problemas = useMemo(() => {
    const salida = new Map<string, string>();
    if (!perezoso) return salida;
    for (const linea of pedido.lineas) {
      const texto = perezoso.reglas.problemaDeLinea(
        linea,
        mapa.get(linea.productoId),
        disponibles,
        pedido.rechazos[linea.clave],
      );
      if (texto) salida.set(linea.clave, texto);
    }
    return salida;
  }, [pedido, mapa, disponibles, perezoso]);

  const platos = platosDelPedido(pedido.lineas);
  const total = useMemo(
    () =>
      perezoso
        ? perezoso.reglas.totalDelPedido(pedido.lineas, mapa, (linea) => problemas.has(linea.clave))
        : null,
    [perezoso, pedido.lineas, mapa, problemas],
  );
  const hojaConReglas = hoja?.tipo === 'producto' || hoja?.tipo === 'pedido';
  useEffect(() => {
    if (pedido.lineas.length > 0 || hojaConReglas) pedirPerezoso();
  }, [pedido.lineas.length, hojaConReglas, pedirPerezoso]);

  // --- "N en tu pedido" en cada fila de la carta y la guía de la carta vacía ---
  useEffect(() => {
    const cuenta = new Map<string, number>();
    for (const l of pedido.lineas)
      cuenta.set(l.productoId, (cuenta.get(l.productoId) ?? 0) + l.cantidad);
    for (const fila of document.querySelectorAll<HTMLElement>('[data-producto-id]')) {
      const etiqueta = fila.querySelector<HTMLElement>('[data-en-pedido]');
      if (!etiqueta) continue;
      const n = cuenta.get(fila.dataset.productoId ?? '') ?? 0;
      etiqueta.hidden = n === 0;
      const texto = etiqueta.querySelector('[data-cuenta]');
      if (texto && n > 0) texto.textContent = `${n} en tu pedido`;
    }
    const guia = document.querySelector<HTMLElement>('[data-guia]');
    if (guia) guia.hidden = pedido.lineas.length > 0;
  }, [pedido.lineas]);

  // --- La barra fija mide su alto para que la carta no quede tapada ---
  useEffect(() => {
    const elemento = barra.current;
    const carta = elemento?.closest<HTMLElement>('.carta');
    if (!elemento || !carta || typeof ResizeObserver === 'undefined') return;
    const medir = () => carta.style.setProperty('--altura-barra', `${elemento.offsetHeight}px`);
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    medir();
    return () => observador.disconnect();
  }, []);

  // --- Tocar un producto de la carta abre su hoja (los productos los pinta el servidor) ---
  const enviandoRef = useRef(false);
  enviandoRef.current = envio !== null;
  useEffect(() => {
    function alTocar(evento: MouseEvent) {
      const origen =
        evento.target instanceof Element ? evento.target.closest('[data-abrir]') : null;
      const id = origen?.closest<HTMLElement>('[data-producto-id]')?.dataset.productoId;
      if (!id || enviandoRef.current) return;
      setHoja({ tipo: 'producto', productoId: id, clave: null, desdePedido: false });
    }
    document.addEventListener('click', alTocar);
    return () => document.removeEventListener('click', alTocar);
  }, []);

  // --- Mesa: lo que dice la API sobre si acepta llamados y si hay uno pendiente ---
  const refrescarMesa = useCallback(
    async (señal?: AbortSignal) => {
      const estado = await consultarMesa(codigo, señal);
      setAcepta(estado.aceptaLlamados);
      setLlamado((previo) => {
        const actual = previo.seguimiento;
        if (estado.llamadoPendiente) {
          if (actual?.estado === 'PENDIENTE') return previo;
          return {
            ...previo,
            seguimiento: { id: null, ...estado.llamadoPendiente, estado: 'PENDIENTE' },
          };
        }
        return actual?.id === null && actual.estado === 'PENDIENTE'
          ? { ...previo, seguimiento: null }
          : previo;
      });
    },
    [codigo],
  );

  // --- Estado del llamado: cada 10 segundos mientras haga falta, con la página visible ---
  const modoDeConsulta: 'llamado' | 'mesa' | null = !cargado
    ? null
    : seguimiento?.id &&
        (pendiente || (seguimiento.estado === 'ATENDIDO' && seguimiento.tipo === 'PEDIDO'))
      ? 'llamado'
      : (seguimiento?.id === null && pendiente) || (!seguimiento && !acepta)
        ? 'mesa'
        : null;
  const idSeguido = seguimiento?.id ?? null;
  useEffect(() => {
    if (modoDeConsulta === null) return;
    const control = new AbortController();
    async function consultar() {
      try {
        if (modoDeConsulta === 'llamado' && idSeguido) {
          const estado = await consultarEstado(codigo, idSeguido, control.signal);
          setLlamado((previo) =>
            previo.seguimiento?.id === idSeguido
              ? {
                  ...previo,
                  seguimiento: {
                    ...previo.seguimiento,
                    estado: estado.estado,
                    venceEn: estado.venceEn,
                  },
                }
              : previo,
          );
        } else {
          await refrescarMesa(control.signal);
        }
      } catch (error) {
        // Sin red o una respuesta rota: se queda lo último y se vuelve a preguntar en el turno siguiente.
        if (error instanceof ErrorApi && error.estado === 404 && modoDeConsulta === 'llamado') {
          setLlamado((previo) => ({ ...previo, seguimiento: null }));
        }
      }
    }
    const alTic = () => {
      if (document.visibilityState === 'visible') void consultar();
    };
    const temporizador = setInterval(alTic, INTERVALO_ESTADO_MS);
    document.addEventListener('visibilitychange', alTic);
    alTic();
    return () => {
      clearInterval(temporizador);
      document.removeEventListener('visibilitychange', alTic);
      control.abort();
    };
  }, [modoDeConsulta, idSeguido, codigo, refrescarMesa]);

  // --- Enviar: el mismo `id` hasta una respuesta final ---
  useEffect(() => {
    if (!cargado || !envio || pausado) return;
    let activo = true;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    let intentosSinRed = 0;
    let fallosDelServidor = 0;

    function alCrear(creado: { id: string; tipo: LlamadoEntrada['tipo']; venceEn: string }) {
      setLlamado({
        envio: null,
        seguimiento: {
          id: creado.id,
          tipo: creado.tipo,
          estado: 'PENDIENTE',
          venceEn: creado.venceEn,
        },
      });
      if (creado.tipo === 'PEDIDO') {
        // Solo se vacía si el pedido sigue siendo el que se envió.
        setPedido((p) => (mismoCuerpo(envio!.cuerpo, cuerpoDelPedido(p)) ? PEDIDO_VACIO : p));
      }
      setAviso(null);
      setHoja(null);
    }

    function alRechazar(error: ErrorApi) {
      let rechazadas = false;
      if (error.estado === 422 && envio!.cuerpo.tipo === 'PEDIDO') {
        const lineas = rechazosDeLineas(error.cuerpo, nombreDeOpcion);
        if (lineas.size > 0) {
          rechazadas = true;
          setPedido((p) => {
            const rechazos = { ...p.rechazos };
            for (const [posicion, motivo] of lineas) {
              const linea = p.lineas[posicion];
              if (linea) rechazos[linea.clave] = motivo;
            }
            return { ...p, rechazos };
          });
        }
      }
      setLlamado((previo) => ({ ...previo, envio: null }));
      setAviso(avisoDeError(error, rechazadas));
      if (error.codigo === 'FUERA_DE_HORARIO') setAcepta(false);
      if (error.codigo === 'LLAMADO_PENDIENTE') void refrescarMesa().catch(() => undefined);
    }

    async function probar() {
      try {
        const creado = await enviarLlamado(codigo, envio!.cuerpo);
        if (activo) alCrear(creado);
      } catch (error) {
        if (!activo) return;
        if (!(error instanceof ErrorApi)) {
          alRechazar(new ErrorApi(500, 'Error inesperado'));
          return;
        }
        if (error.esDeRed) {
          setAviso(AVISO_SIN_CONEXION);
          const espera =
            ESPERAS_REINTENTO_MS[Math.min(intentosSinRed, ESPERAS_REINTENTO_MS.length - 1)]!;
          intentosSinRed += 1;
          temporizador = setTimeout(() => void probar(), espera);
        } else if (esReintentable(error)) {
          if (fallosDelServidor < REINTENTOS_DE_SERVIDOR) {
            const espera = ESPERAS_REINTENTO_MS[fallosDelServidor]!;
            fallosDelServidor += 1;
            temporizador = setTimeout(() => void probar(), espera);
          } else {
            // Se conserva el envío (y su `id`): al pulsar otra vez se reintenta sin duplicar.
            setPausado(true);
            setAviso(avisoDeError(error));
          }
        } else {
          alRechazar(error);
        }
      }
    }

    void probar();
    return () => {
      activo = false;
      clearTimeout(temporizador);
    };
    // `reintento` reinicia el envío cuando el cliente vuelve a pulsar tras un error del servidor.
  }, [cargado, envio, pausado, reintento, codigo, nombreDeOpcion, refrescarMesa]);

  function iniciarEnvio(cuerpo: Omit<LlamadoEntrada, 'id'>) {
    // Mismo pedido que un envío que quedó a medias: mismo `id`. Otro pedido: `id` nuevo.
    const id = envio && mismoCuerpo(envio.cuerpo, cuerpo) ? envio.id : nuevoId();
    setLlamado((previo) => ({
      ...previo,
      envio: { id, cuerpo: { ...cuerpo, id } as LlamadoEntrada },
    }));
    setAviso(null);
    setPausado(false);
    setReintento((n) => n + 1);
  }

  function cancelarEnvio() {
    setLlamado((previo) => ({ ...previo, envio: null }));
    setPausado(false);
    setAviso(null);
  }

  function cerrarHoja() {
    setHoja(null);
    if (!envio) setAviso(null);
  }

  // --- Lo que apaga los envíos y por qué ---
  const motivoDeLlamado = pendiente
    ? 'Ya avisamos al mozo. Podrás enviar otro cuando te atiendan.'
    : !acepta
      ? 'El local está cerrado ahora. Habla con el mozo.'
      : null;
  const hayProblemas = problemas.size > 0;
  const motivoDelPedido =
    pedido.lineas.length === 0
      ? 'Agrega al menos un plato.'
      : hayProblemas
        ? [...problemas.values()].every((p) => p === 'Se agotó' || p === 'Ya no se vende')
          ? 'Quita lo que se agotó para poder enviar.'
          : 'Edita o quita lo que está marcado para poder enviar.'
        : motivoDeLlamado;
  const enviando = envio !== null && !pausado;

  // --- Lo que dice la barra ---
  const estado = seguimiento ? avisoDeEstado(seguimiento.estado) : null;
  let avisos = null;
  if (aviso && hoja === null) {
    avisos = (
      <Aviso
        aviso={aviso}
        accion={
          enviando ? (
            <button type="button" className="boton-texto aviso__cerrar" onClick={cancelarEnvio}>
              Cancelar el envío
            </button>
          ) : (
            <button
              type="button"
              className="boton-texto aviso__cerrar"
              onClick={() => setAviso(null)}
            >
              Entendido
            </button>
          )
        }
      />
    );
  } else if (enviando && hoja === null) {
    avisos = (
      <Aviso
        aviso={{ tono: 'info', icono: 'campana', titulo: 'Enviando…', rol: 'status' }}
        accion={
          <button type="button" className="boton-texto aviso__cerrar" onClick={cancelarEnvio}>
            Cancelar el envío
          </button>
        }
      />
    );
  } else if (estado) {
    avisos = (
      <Aviso
        aviso={estado}
        accion={
          estado.final ? (
            <button
              type="button"
              className="boton-texto aviso__cerrar"
              onClick={() => setLlamado((previo) => ({ ...previo, seguimiento: null }))}
            >
              Entendido
            </button>
          ) : undefined
        }
      />
    );
  } else if (!acepta) {
    avisos = <Aviso aviso={{ ...AVISO_LOCAL_CERRADO, rol: 'status' }} />;
  }

  // --- Acciones del pedido ---
  const producto = hoja?.tipo === 'producto' ? mapa.get(hoja.productoId) : undefined;
  const lineaEnEdicion =
    hoja?.tipo === 'producto' && hoja.clave
      ? pedido.lineas.find((l) => l.clave === hoja.clave)
      : undefined;

  return (
    <>
      <BarraDeMesa
        barraRef={barra}
        avisos={avisos}
        pedido={
          pedido.lineas.length > 0
            ? {
                platos,
                total: perezoso && total !== null ? <perezoso.Monto valor={total} /> : null,
              }
            : null
        }
        envioApagado={pendiente || !acepta || envio !== null}
        alVerPedido={() => setHoja({ tipo: 'pedido' })}
        alLlamar={() => setHoja({ tipo: 'confirmar', cual: 'llamar' })}
        alPedirCuenta={() => setHoja({ tipo: 'confirmar', cual: 'cuenta' })}
      />

      {hojaConReglas && !perezoso ? (
        <p className="abriendo" role="status">
          {falloLaCarga
            ? 'No pudimos abrir esto. Revisa tu conexión e inténtalo otra vez.'
            : 'Abriendo…'}
        </p>
      ) : null}

      {perezoso && hoja?.tipo === 'producto' && producto ? (
        <perezoso.HojaDeProducto
          key={hoja.clave ?? hoja.productoId}
          producto={producto}
          noDisponibles={disponibles?.get(producto.id) ?? SIN_NO_DISPONIBLES}
          linea={lineaEnEdicion}
          lleno={pedido.lineas.length >= MAXIMO_LINEAS_LLAMADO}
          alGuardar={(linea) => {
            if (hoja.clave) {
              setPedido((p) => reemplazarLinea(p, hoja.clave!, linea));
            } else {
              const resultado = perezoso.reglas.agregarLinea(pedido, linea);
              if ('pedido' in resultado) setPedido(resultado.pedido);
            }
            setHoja(hoja.desdePedido ? { tipo: 'pedido' } : null);
          }}
          alCerrar={() => setHoja(hoja.desdePedido ? { tipo: 'pedido' } : null)}
        />
      ) : null}

      {perezoso && hoja?.tipo === 'pedido' ? (
        <perezoso.HojaDePedido
          mesa={mesa}
          lineas={pedido.lineas}
          productos={mapa}
          problemas={problemas}
          nota={pedido.nota}
          platos={platos}
          total={total ?? '0.00'}
          motivoBloqueo={enviando ? null : motivoDelPedido}
          enviando={enviando}
          aviso={aviso}
          alEditar={(clave) => {
            const linea = pedido.lineas.find((l) => l.clave === clave);
            if (linea) {
              setHoja({ tipo: 'producto', productoId: linea.productoId, clave, desdePedido: true });
            }
          }}
          alQuitar={(clave) => setPedido((p) => quitarLinea(p, clave))}
          alCambiarNota={(nota) => setPedido((p) => ({ ...p, nota }))}
          alEnviar={() => iniciarEnvio(cuerpoDelPedido(pedido))}
          alCancelarEnvio={cancelarEnvio}
          alCerrar={cerrarHoja}
        />
      ) : null}

      {hoja?.tipo === 'confirmar' ? (
        <HojaDeConfirmar
          tipo={hoja.cual}
          mesa={mesa}
          enviando={enviando}
          aviso={aviso}
          motivoBloqueo={enviando ? null : motivoDeLlamado}
          alConfirmar={() =>
            iniciarEnvio({ tipo: hoja.cual === 'llamar' ? 'LLAMAR_MOZO' : 'PEDIR_CUENTA' })
          }
          alCancelarEnvio={cancelarEnvio}
          alCerrar={cerrarHoja}
        />
      ) : null}
    </>
  );
}
