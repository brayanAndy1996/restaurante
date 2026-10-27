import type { RegimenTributario } from '@restaurante/dominio';
import { Aviso, Boton, CampoAreaTexto, ErrorDeCarga, EsqueletoDeLista } from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { ErrorApi, erroresPorCampo, mensajeDeCampo, mensajeDeError } from '../../lib/errores';
import { CamposDeEmisor } from './campos';
import { useClaveDeEscritura } from './claves';
import { validarEmisor, validarMotivo, type EmisorForm, type Errores } from './empresa-form';
import { CLAVES, agregarEmisor, obtenerEmpresa } from './plataforma';

/** Agrega un emisor (otro RUC) a una empresa que ya existe (criterio 101). */
export function EmisorNuevoPagina() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const clientes = useQueryClient();
  const clave = useClaveDeEscritura();
  const empresa = useQuery({
    queryKey: CLAVES.empresa(id),
    queryFn: ({ signal }) => obtenerEmpresa(id, signal),
  });
  const [emisor, setEmisor] = useState<Pick<EmisorForm, 'ruc' | 'razonSocial' | 'regimen'>>({
    ruc: '',
    razonSocial: '',
    regimen: '',
  });
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Errores>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const atras = { a: `/plataforma/empresas/${id}`, etiqueta: 'Empresa' };

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    const nuevos = validarEmisor(emisor, '');
    const m = validarMotivo(motivo);
    if (m) nuevos.motivo = m;
    if (empresa.data?.emisores.some((e) => e.ruc === emisor.ruc.trim()) && !nuevos.ruc)
      nuevos.ruc = 'Esta empresa ya tiene un emisor con este RUC';
    setErrores(nuevos);
    setFallo(null);
    if (Object.keys(nuevos).length > 0) return;

    setEnviando(true);
    try {
      await agregarEmisor(
        id,
        {
          ruc: emisor.ruc.trim(),
          razonSocial: emisor.razonSocial.trim(),
          regimen: emisor.regimen as RegimenTributario,
          motivo: motivo.trim(),
        },
        clave.obtener(),
      );
      clave.soltar();
      await clientes.invalidateQueries({ queryKey: CLAVES.empresa(id) });
      void clientes.invalidateQueries({ queryKey: CLAVES.empresas });
      navegar(`/plataforma/empresas/${id}`, {
        replace: true,
        state: { aviso: `Emisor ${emisor.razonSocial.trim()} agregado.` },
      });
    } catch (e) {
      const error =
        e instanceof ErrorApi
          ? e
          : new ErrorApi({ estado: 0, codigo: 'ERROR_INTERNO', mensaje: '' });
      clave.alFallar(error);
      const campos = erroresPorCampo(error);
      if (error.codigo === 'DATOS_INVALIDOS' && Object.keys(campos).length > 0) {
        setErrores(
          Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, mensajeDeCampo(v)])),
        );
        setFallo('Revisa los datos marcados e inténtalo de nuevo.');
      } else {
        setFallo(mensajeDeError(error));
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Pagina
      titulo="Agregar emisor"
      plataforma
      atras={atras}
      pie={
        <Boton
          variante="principal"
          bloque
          type="submit"
          form="formulario-emisor"
          cargando={enviando}
          textoCargando="Agregando…"
          disabled={empresa.isPending || empresa.isError}
        >
          Agregar emisor
        </Boton>
      }
    >
      {empresa.isPending ? (
        <EsqueletoDeLista etiqueta="Cargando la empresa" conInicial={false} filas={2} />
      ) : empresa.isError ? (
        <ErrorDeCarga
          titulo="No pudimos cargar la empresa"
          onReintentar={() => void empresa.refetch()}
          reintentando={empresa.isFetching}
        >
          {mensajeDeError(empresa.error)}
        </ErrorDeCarga>
      ) : (
        <>
          <p className="ui-subtitulo">{`Otro RUC para ${empresa.data.nombre}.`}</p>
          {fallo ? (
            <Aviso tipo="error" titulo="No pudimos agregar el emisor">
              {fallo}
            </Aviso>
          ) : null}
          <form id="formulario-emisor" className="formulario" onSubmit={enviar} noValidate>
            <CamposDeEmisor
              valor={emisor}
              onCambio={(parcial) => setEmisor((e) => ({ ...e, ...parcial }))}
              errores={errores}
            />
            <CampoAreaTexto
              etiqueta="Motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              error={errores.motivo}
              ayuda="Queda registrado con tu nombre."
              maxLength={300}
              rows={2}
            />
          </form>
        </>
      )}
    </Pagina>
  );
}
