import {
  Aviso,
  Boton,
  CampoAreaTexto,
  Esqueleto,
  IconoCopiar,
  IconoOk,
  IconoReintentar,
  copiarTexto,
} from '@restaurante/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ahoraDelServidor, nuevaClaveDeIdempotencia } from '../../../lib/api';
import { relojDeCuenta } from '../../../lib/formato';
import { CodigoQr } from './CodigoQr';
import { crearVinculacion, falloDeVinculacion, segundosRestantes } from './puente';

/** Desde cuántos segundos el reloj avisa con palabras que el código está por vencer. */
const SEGUNDOS_DE_AVISO = 60;

/** "9 minutos con 42 segundos": lo que oye un lector de pantalla en lugar de "9:42". */
function leerReloj(segundos: number): string {
  const minutos = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} con ${resto} ${resto === 1 ? 'segundo' : 'segundos'}`;
}

interface Props {
  sucursalId: string;
  /** Nombre del puente activo, que el nuevo reemplazará (criterio 108), o `null` si no hay. */
  reemplaza: string | null;
  onCerrar: () => void;
}

/**
 * "Vincular puente" (criterios 106 y 137): pide un código de un solo uso y lo muestra como QR grande, como
 * texto para copiar y con una cuenta regresiva de 10 minutos. Al vencer, el QR y el texto desaparecen y se
 * ofrece generar otro. Quien lo usa se entera de que el puente se vinculó por el estado de la impresión y
 * cierra este panel.
 *
 * La clave de idempotencia se conserva mientras el código no salga: un reintento por un corte no crea otro.
 * Al generar "otro código" a propósito, la clave es nueva (y la API invalida el anterior).
 */
export function VincularPuente({ sucursalId, reemplaza, onCerrar }: Props) {
  const clave = useRef(nuevaClaveDeIdempotencia());
  const iniciado = useRef(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  const [ahora, setAhora] = useState(() => ahoraDelServidor());
  const [copiado, setCopiado] = useState<'si' | 'no' | null>(null);

  const crear = useMutation({
    mutationFn: () => crearVinculacion(sucursalId, clave.current),
  });
  const vinculacion = crear.data;

  function pedirCodigo() {
    setCopiado(null);
    crear.mutate();
  }

  useEffect(() => {
    if (iniciado.current) return;
    iniciado.current = true;
    titulo.current?.focus();
    titulo.current?.scrollIntoView?.({ block: 'nearest' });
    crear.mutate();
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!vinculacion) return;
    setAhora(ahoraDelServidor());
    const reloj = setInterval(() => setAhora(ahoraDelServidor()), 1000);
    return () => clearInterval(reloj);
  }, [vinculacion]);

  const restantes = vinculacion ? segundosRestantes(vinculacion.expiraEn, ahora) : 0;
  const vencido = vinculacion !== undefined && restantes === 0;

  function otroCodigo() {
    // Un código nuevo a propósito: clave nueva. (Un reintento tras un fallo conserva la anterior.)
    clave.current = nuevaClaveDeIdempotencia();
    crear.reset();
    pedirCodigo();
  }

  return (
    <section className="puente__vincular" aria-labelledby="puente-vincular">
      <h4 className="puente__subtitulo" id="puente-vincular" ref={titulo} tabIndex={-1}>
        Vincular el puente
      </h4>

      {reemplaza ? (
        <Aviso tipo="alerta" titulo={`Reemplazará a ${reemplaza}`}>
          Cuando el nuevo puente se vincule, el actual dejará de imprimir.
        </Aviso>
      ) : null}

      {!vinculacion && !crear.isError ? (
        <div className="puente__cargando" role="status">
          <Esqueleto className="qr__esqueleto" />
          <span>Generando el código…</span>
        </div>
      ) : null}

      {crear.isError ? (
        <>
          <Aviso tipo="error" titulo="No pudimos generar el código">
            {falloDeVinculacion(crear.error)}
          </Aviso>
          <Boton icono={IconoReintentar} bloque onClick={pedirCodigo}>
            Reintentar
          </Boton>
        </>
      ) : null}

      {vinculacion && !vencido ? (
        <>
          <div className="qr">
            <CodigoQr texto={vinculacion.qr} etiqueta="Código QR para vincular el puente" />
            <p className={restantes <= SEGUNDOS_DE_AVISO ? 'qr__reloj qr__reloj--pronto' : 'qr__reloj'}>
              <span>Vence en</span>
              <b role="timer" aria-label={`Vence en ${leerReloj(restantes)}`}>
                {relojDeCuenta(restantes)}
              </b>
            </p>
            <p className="texto-ayuda qr__aviso" role="status">
              {restantes <= SEGUNDOS_DE_AVISO ? 'Queda menos de un minuto.' : ''}
            </p>
          </div>
          <p>
            Abre la app puente en el celular Android del local y escanea este código. Sirve una sola
            vez.
          </p>
          <CampoAreaTexto
            etiqueta="Si no puedes escanear, copia este texto"
            ayuda="Pégalo en la app puente. Es de un solo uso: no lo compartas."
            value={vinculacion.qr}
            readOnly
            rows={4}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div role="status" className="ui-solo-lectores">
            {copiado === 'si' ? 'Texto copiado' : ''}
          </div>
          {copiado === 'no' ? (
            <Aviso tipo="info">No pudimos copiarlo. Toca el texto, selecciónalo y cópialo.</Aviso>
          ) : null}
          <Boton
            bloque
            icono={copiado === 'si' ? IconoOk : IconoCopiar}
            onClick={async () => setCopiado((await copiarTexto(vinculacion.qr)) ? 'si' : 'no')}
          >
            {copiado === 'si' ? 'Texto copiado' : 'Copiar texto'}
          </Boton>
        </>
      ) : null}

      {vencido ? (
        <>
          <Aviso tipo="alerta" titulo="El código venció">
            Por seguridad dura 10 minutos y se usa una sola vez. Genera otro para vincular.
          </Aviso>
          <Boton icono={IconoReintentar} bloque onClick={otroCodigo}>
            Generar otro código
          </Boton>
        </>
      ) : null}

      <Boton variante="texto" onClick={onCerrar}>
        {vinculacion && !vencido ? 'Cancelar' : 'Cerrar'}
      </Boton>
    </section>
  );
}
