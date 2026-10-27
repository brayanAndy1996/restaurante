import type { AutorizacionRespuesta } from '@restaurante/contratos';
import type { Accion } from '@restaurante/dominio';
import { Aviso, Boton, CampoSeleccion, IconoLlave } from '@restaurante/ui';
import { useState } from 'react';
import { Pagina } from '../../componentes/Pagina';
import { useClaveDeSupervisor } from '../../componentes/useClaveDeSupervisor';
import { relojDeCuenta } from '../../lib/formato';
import { useSegundosHasta } from '../../lib/tiempo';
import { usePermiso } from '../acceso/permisos';

/**
 * SOLO DESARROLLO (la ruta no existe en el paquete de producción). Todavía no hay acciones protegidas
 * reales, así que esta pantalla ejercita la ventana de clave de supervisor contra la API de verdad:
 * pide la clave de una acción de muestra, recibe la autorización y dice cuánto le queda de vida. Las
 * descripciones son textos de muestra, no datos.
 */
const ACCIONES_DE_MUESTRA: { accion: Accion; descripcion: string }[] = [
  { accion: 'ANULAR_ITEM_ENVIADO', descripcion: 'Anular ítem: Ceviche mixto x1 (muestra)' },
  {
    accion: 'APLICAR_DESCUENTO',
    descripcion: 'Aplicar descuento a la cuenta de la mesa 4 (muestra)',
  },
  { accion: 'ANULAR_ORDEN', descripcion: 'Anular la orden de la mesa 7 (muestra)' },
];

function VigenciaDeLaAutorizacion({ autorizacion }: { autorizacion: AutorizacionRespuesta }) {
  const faltan = useSegundosHasta(autorizacion.expiraEn);
  return faltan > 0 ? (
    <span role="timer" aria-label={`Vale ${relojDeCuenta(faltan)} más`}>
      Vale {relojDeCuenta(faltan)} más, para una sola acción.
    </span>
  ) : (
    <span>Ya venció: hay que pedir la clave otra vez.</span>
  );
}

export function ClaveSupervisorDemo() {
  const [elegida, setElegida] = useState<Accion>('ANULAR_ITEM_ENVIADO');
  const [autorizacion, setAutorizacion] = useState<AutorizacionRespuesta | null>(null);
  const [cancelada, setCancelada] = useState(false);
  const { pedir, ventana } = useClaveDeSupervisor();
  const requisito = usePermiso(elegida);
  const muestra = ACCIONES_DE_MUESTRA.find((a) => a.accion === elegida)!;

  async function pedirClave() {
    setCancelada(false);
    const resultado = await pedir({ accion: muestra.accion, descripcion: muestra.descripcion });
    setAutorizacion(resultado);
    setCancelada(resultado === null);
  }

  return (
    <Pagina titulo="Clave de supervisor (demostración)">
      <Aviso tipo="info" titulo="Solo para desarrollo">
        Esta pantalla no existe en producción. Sirve para ver la ventana de clave funcionando contra
        la API.
      </Aviso>
      <CampoSeleccion
        etiqueta="Acción"
        value={elegida}
        onChange={(e) => {
          setElegida(e.target.value as Accion);
          setAutorizacion(null);
          setCancelada(false);
        }}
      >
        {ACCIONES_DE_MUESTRA.map((a) => (
          <option key={a.accion} value={a.accion}>
            {a.descripcion}
          </option>
        ))}
      </CampoSeleccion>

      {requisito === 'clave' ? (
        <Boton variante="principal" bloque icono={IconoLlave} onClick={() => void pedirClave()}>
          Pedir clave de supervisor
        </Boton>
      ) : requisito === 'permitido' ? (
        <Aviso tipo="ok" titulo="Tu rol no necesita clave">
          Esta acción se haría directamente, sin pedir la clave de un supervisor.
        </Aviso>
      ) : (
        <Aviso tipo="alerta" titulo="Tu rol no puede hacer esta acción">
          Una pantalla real no la ofrecería.
        </Aviso>
      )}

      {autorizacion ? (
        <Aviso tipo="ok" titulo={`Autorizó ${autorizacion.autorizadoPor.nombre}`}>
          <span className="ui-solo-lectores">Autorización </span>
          <code data-testid="autorizacion-id">{autorizacion.autorizacionId}</code>
          <br />
          <VigenciaDeLaAutorizacion autorizacion={autorizacion} />
        </Aviso>
      ) : null}
      {cancelada ? <Aviso tipo="info">Se cerró la ventana sin autorizar.</Aviso> : null}
      {ventana}
    </Pagina>
  );
}
