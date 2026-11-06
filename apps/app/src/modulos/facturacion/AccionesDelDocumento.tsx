import type { ComprobanteRespuesta } from '@restaurante/contratos';
import { Aviso, Boton, CampoTexto, IconoCompartir, IconoDocumento } from '@restaurante/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { MUTACION_SIN_PAUSA } from '../../lib/envios';
import { tieneFacturacion } from '../acceso/navegacion';
import { useSesionActiva } from '../acceso/sesion';
import {
  TEXTO_CELULAR_INVALIDO,
  abrirPestanaEnBlanco,
  avisoDeDisponibilidad,
  celularParaWhatsApp,
  direccionDeWhatsApp,
  esPdfNoDisponible,
  leerEnlace,
  leerPdf,
  llevarPestana,
  mensajeDeFalloDelPdf,
  textoParaWhatsApp,
} from './compartir';
import { claveComprobante, leerComprobante } from './facturacion';
import './entrega.css';

type Documento = Pick<
  ComprobanteRespuesta,
  'id' | 'tipo' | 'numero' | 'estado' | 'emisor' | 'totales'
> & { pdfDisponible?: boolean | undefined };

interface Props {
  /** Lo que respondió la emisión; el estado vivo del comprobante (si la pantalla ya lo tiene) manda sobre esto. */
  comprobante: Documento;
  /** Con dos documentos en la misma pantalla (la nota y la factura nueva de un cambio), cada botón dice de cuál es. */
  conNumero?: boolean;
}

/** Cuánto vive la dirección `blob:` del PDF; la pestaña ya lo cargó mucho antes. */
const VIDA_DEL_PDF_MS = 5 * 60_000;

/** Un fallo de PDF o de enlace: «todavía no» (informa) o una falla de verdad (error). */
function FalloDelDocumento({ error, titulo }: { error: unknown; titulo: string }) {
  if (esPdfNoDisponible(error)) {
    return (
      <Aviso tipo="info" titulo="El PDF aún no está listo">
        {mensajeDeFalloDelPdf(error)}
      </Aviso>
    );
  }
  return (
    <Aviso tipo="error" titulo={titulo}>
      {mensajeDeFalloDelPdf(error)}
    </Aviso>
  );
}

/**
 * «Ver PDF» y «Compartir por WhatsApp» de un comprobante (criterios 159 a 161 y 174), en el detalle y en los resultados
 * del cobro, de la venta de mostrador y de la nota de crédito.
 *
 * - **Ver PDF:** el PDF pide sesión, así que se baja con la sesión de la persona y se abre como `blob:` en otra pestaña.
 * - **Compartir por WhatsApp:** pide el enlace público (vigente 30 días) y abre `wa.me` con el mensaje; el celular del
 *   cliente es opcional, no se guarda y no viaja a la API (solo va en la dirección de `wa.me`).
 *
 * Los botones siempre se pueden tocar: el servidor dice si el PDF ya está (`409 PDF_NO_DISPONIBLE`) y la pantalla lo
 * cuenta; antes del toque, una línea de ayuda avisa lo que ya se sabe (SUNAT aún no aceptó). Sin el módulo de
 * Facturación en el plan no hay PDF ni enlace y no se muestra nada.
 */
export function AccionesDelDocumento({ comprobante, conNumero }: Props) {
  const sesion = useSesionActiva();
  const habilitado = tieneFacturacion(sesion);
  // Solo lee lo que la pantalla ya trajo (el estado vivo): no pide nada por su cuenta.
  const vivo = useQuery({
    queryKey: claveComprobante(comprobante.id),
    queryFn: ({ signal }) => leerComprobante(comprobante.id, signal),
    enabled: false,
  }).data;
  const documento: Documento = vivo ?? comprobante;

  const idDelFormulario = useId();
  const [compartiendo, setCompartiendo] = useState(false);
  const [celular, setCelular] = useState('');
  const [errorDeCelular, setErrorDeCelular] = useState<string | undefined>();
  /** Si el navegador bloqueó la pestaña, la dirección queda aquí para que la persona la toque. */
  const [manual, setManual] = useState<{ para: 'pdf' | 'whatsapp'; url: string } | null>(null);

  const pdf = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: async () => {
      setManual(null);
      const pestana = abrirPestanaEnBlanco();
      try {
        const archivo = await leerPdf(documento.id);
        const url = URL.createObjectURL(archivo);
        setTimeout(() => URL.revokeObjectURL(url), VIDA_DEL_PDF_MS);
        if (!llevarPestana(pestana, url)) setManual({ para: 'pdf', url });
      } catch (error) {
        pestana?.close();
        throw error;
      }
    },
  });

  const whatsapp = useMutation({
    ...MUTACION_SIN_PAUSA,
    mutationFn: async (numero: string | null) => {
      setManual(null);
      const pestana = abrirPestanaEnBlanco();
      try {
        const enlace = await leerEnlace(documento.id);
        const direccion = direccionDeWhatsApp(textoParaWhatsApp(documento, enlace.url), numero);
        if (!llevarPestana(pestana, direccion)) setManual({ para: 'whatsapp', url: direccion });
      } catch (error) {
        pestana?.close();
        throw error;
      }
    },
    onSuccess: () => {
      // El celular no se guarda: se olvida apenas se usa.
      setCelular('');
      setCompartiendo(false);
    },
  });

  if (!habilitado) return null;
  const ayuda = avisoDeDisponibilidad(documento);

  function compartir(evento: FormEvent) {
    evento.preventDefault();
    const entendido = celularParaWhatsApp(celular);
    if (!entendido) {
      setErrorDeCelular(TEXTO_CELULAR_INVALIDO);
      return;
    }
    setErrorDeCelular(undefined);
    whatsapp.mutate(entendido.numero);
  }

  return (
    <section className="entrega" aria-label="Entregar el comprobante al cliente">
      <div className="entrega__botones">
        <Boton
          bloque
          icono={IconoDocumento}
          cargando={pdf.isPending}
          textoCargando="Abriendo el PDF…"
          {...(conNumero ? { 'aria-label': `Ver PDF de ${documento.numero}` } : {})}
          onClick={() => pdf.mutate()}
        >
          Ver PDF
        </Boton>
        <Boton
          bloque
          icono={IconoCompartir}
          aria-expanded={compartiendo}
          aria-controls={idDelFormulario}
          {...(conNumero ? { 'aria-label': `Compartir por WhatsApp ${documento.numero}` } : {})}
          onClick={() => setCompartiendo((abierto) => !abierto)}
        >
          Compartir por WhatsApp
        </Boton>
      </div>
      {ayuda ? <p className="texto-ayuda entrega__ayuda">{ayuda}</p> : null}

      {pdf.isError ? (
        <FalloDelDocumento error={pdf.error} titulo="No pudimos abrir el PDF" />
      ) : null}
      {manual?.para === 'pdf' ? (
        <a className="entrega__enlace" href={manual.url} target="_blank" rel="noreferrer">
          Tu navegador bloqueó la pestaña. Toca aquí para abrir el PDF.
        </a>
      ) : null}

      {compartiendo ? (
        <form className="entrega__whatsapp" id={idDelFormulario} onSubmit={compartir} noValidate>
          <CampoTexto
            etiqueta="Celular del cliente"
            opcional
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="987 654 321"
            value={celular}
            onChange={(e) => {
              setCelular(e.target.value);
              setErrorDeCelular(undefined);
            }}
            error={errorDeCelular}
            ayuda="Si lo dejas vacío, eliges el contacto en WhatsApp. No lo guardamos."
          />
          <Boton
            type="submit"
            bloque
            cargando={whatsapp.isPending}
            textoCargando="Preparando el enlace…"
          >
            Abrir WhatsApp
          </Boton>
          {whatsapp.isError ? (
            <FalloDelDocumento error={whatsapp.error} titulo="No pudimos preparar el enlace" />
          ) : null}
        </form>
      ) : null}
      {manual?.para === 'whatsapp' ? (
        <a className="entrega__enlace" href={manual.url} target="_blank" rel="noreferrer">
          Tu navegador bloqueó la pestaña. Toca aquí para abrir WhatsApp.
        </a>
      ) : null}
    </section>
  );
}
