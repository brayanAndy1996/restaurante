import type { EstadoImpresionRespuesta, ImpresoraRespuesta } from '@restaurante/contratos';
import { Aviso, Boton, IconoImpresora } from '@restaurante/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { MUTACION_SIN_PAUSA, type ExtraDeEscritura } from '../../../lib/envios';
import { mensajeDeError } from '../../../lib/errores';
import { PREFIJO_DE_TRABAJOS } from '../../impresion/trabajos';
import { NOTA_DE_BLUETOOTH } from './impresion';
import { claveEstadoImpresion, imprimirPaginaDePrueba } from './puente';

type Enviar = <T>(ejecutar: (extra: ExtraDeEscritura) => Promise<T>) => Promise<T>;

interface Props {
  sucursalId: string;
  impresora: ImpresoraRespuesta;
  enviar: Enviar;
}

/**
 * "Imprimir página de prueba" en la ficha de la impresora (criterios 127 y 136): manda al puente una hoja con
 * el nombre, el ancho, una regla y una muestra de tildes y de un monto, para ver si se lee bien antes de usarla
 * (si salen símbolos raros, se prueba otro juego de caracteres). Funciona aunque la impresora esté desactivada.
 * Cada toque es una página nueva, con su propia clave de idempotencia.
 */
export function PaginaDePrueba({ sucursalId, impresora, enviar }: Props) {
  const clientes = useQueryClient();
  const [enCola, setEnCola] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const imprimir = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: () => enviar((extra) => imprimirPaginaDePrueba(sucursalId, impresora.id, extra)),
  });

  async function pedir() {
    setEnCola(false);
    setFallo(null);
    try {
      await imprimir.mutateAsync();
      setEnCola(true);
      void clientes.invalidateQueries({ queryKey: PREFIJO_DE_TRABAJOS });
    } catch (error) {
      setFallo(mensajeDeError(error));
    }
  }

  // Lo que ya se sabe del puente decide qué se le promete a la persona.
  const puente = clientes.getQueryData<EstadoImpresionRespuesta>(claveEstadoImpresion(sucursalId))
    ?.puente;
  const cuando =
    impresora.conexion.tipo === 'BLUETOOTH'
      ? `${NOTA_DE_BLUETOOTH}: hasta entonces la página espera en la cola.`
      : puente?.conectado
        ? `Sale en unos segundos por ${impresora.nombre}.`
        : 'Todavía no hay un puente conectado: la página sale en cuanto se conecte.';

  return (
    <div className="impresion__grupo">
      <p className="ui-campo__etiqueta">Probar la impresora</p>
      <p className="texto-ayuda">
        Imprime una hoja con tildes, la letra Ñ y un monto de muestra. Si algo sale raro, cambia el juego
        de caracteres y prueba otra vez. Funciona aunque la impresora esté desactivada.
      </p>
      {fallo ? (
        <Aviso tipo="error" titulo="No pudimos mandar la página de prueba">
          {fallo}
        </Aviso>
      ) : null}
      {enCola ? (
        <Aviso tipo="ok" titulo="Página de prueba en cola">
          {`${cuando} Búscala en “Trabajos de hoy”.`}
        </Aviso>
      ) : null}
      <Boton
        bloque
        icono={IconoImpresora}
        cargando={imprimir.isPending}
        textoCargando="Enviando…"
        onClick={() => void pedir()}
      >
        Imprimir página de prueba
      </Boton>
    </div>
  );
}
