import { fechaLima } from '@restaurante/dominio';
import { Aviso, Boton, CampoAreaTexto, ErrorDeCarga, EsqueletoDeLista } from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { ErrorApi, erroresPorCampo, mensajeDeCampo, mensajeDeError } from '../../lib/errores';
import { CamposDeSucursal } from './campos';
import { useClaveDeEscritura } from './claves';
import { sucursalVacia, validarMotivo, validarSucursal, type Errores } from './empresa-form';
import { CLAVES, agregarSucursal, listarPlanes, obtenerEmpresa } from './plataforma';

/** Agrega una sucursal, con su suscripción, a una empresa que ya existe (criterio 101). */
export function SucursalNuevaPagina() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const clientes = useQueryClient();
  const clave = useClaveDeEscritura();
  const hoy = fechaLima(new Date());
  const empresa = useQuery({
    queryKey: CLAVES.empresa(id),
    queryFn: ({ signal }) => obtenerEmpresa(id, signal),
  });
  const planes = useQuery({
    queryKey: CLAVES.planes,
    queryFn: ({ signal }) => listarPlanes(signal),
  });
  const [valor, setValor] = useState(() => sucursalVacia());
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Errores>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const atras = { a: `/plataforma/empresas/${id}`, etiqueta: 'Empresa' };
  const emisores = (empresa.data?.emisores ?? []).map((e) => ({
    id: e.id,
    texto: `${e.ruc} · ${e.razonSocial}`,
  }));
  // Con un solo emisor no hay nada que elegir: queda elegido.
  const emisorId = valor.emisorId || (emisores.length === 1 ? (emisores[0]?.id ?? '') : '');

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando || !empresa.data) return;
    const nuevos = validarSucursal(valor, '', hoy);
    const emisor = empresa.data.emisores.find((e) => e.id === emisorId);
    if (!emisor) nuevos.rucEmisor = 'Elige el emisor de la sucursal';
    const m = validarMotivo(motivo);
    if (m) nuevos.motivo = m;
    setErrores(nuevos);
    setFallo(null);
    if (Object.keys(nuevos).length > 0 || !emisor) return;

    const suscripcion = {
      ...(valor.planId ? { planId: valor.planId } : {}),
      ...(valor.vencimiento.trim() ? { vencimiento: valor.vencimiento.trim() } : {}),
    };
    setEnviando(true);
    try {
      await agregarSucursal(
        id,
        {
          rucEmisor: emisor.ruc,
          nombre: valor.nombre.trim(),
          codigoEstablecimiento: valor.codigoEstablecimiento.trim(),
          direccion: valor.direccion.trim(),
          ...(valor.whatsapp.trim() ? { whatsapp: valor.whatsapp.trim() } : {}),
          ...(Object.keys(suscripcion).length > 0 ? { suscripcion } : {}),
          motivo: motivo.trim(),
        },
        clave.obtener(),
      );
      clave.soltar();
      await clientes.invalidateQueries({ queryKey: CLAVES.empresa(id) });
      void clientes.invalidateQueries({ queryKey: ['plataforma', 'suscripciones'] });
      void clientes.invalidateQueries({ queryKey: CLAVES.empresas });
      navegar(`/plataforma/empresas/${id}`, {
        replace: true,
        state: { aviso: `Sucursal ${valor.nombre.trim()} agregada, con su suscripción.` },
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
      } else if (error.codigo === 'CONFLICTO') {
        setErrores({
          codigoEstablecimiento: 'Este emisor ya tiene una sucursal con ese código o nombre.',
        });
      } else {
        setFallo(mensajeDeError(error));
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Pagina
      titulo="Agregar sucursal"
      plataforma
      atras={atras}
      pie={
        <Boton
          variante="principal"
          bloque
          type="submit"
          form="formulario-sucursal"
          cargando={enviando}
          textoCargando="Agregando…"
          disabled={empresa.isPending || empresa.isError}
        >
          Agregar sucursal
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
          <p className="ui-subtitulo">{`Una sucursal más para ${empresa.data.nombre}. Nace con su suscripción.`}</p>
          {fallo ? (
            <Aviso tipo="error" titulo="No pudimos agregar la sucursal">
              {fallo}
            </Aviso>
          ) : null}
          <form id="formulario-sucursal" className="formulario" onSubmit={enviar} noValidate>
            <CamposDeSucursal
              valor={{ ...valor, emisorId }}
              onCambio={(parcial) => setValor((v) => ({ ...v, ...parcial }))}
              errores={errores}
              emisores={emisores}
              planes={(planes.data ?? []).filter((p) => p.activo)}
              hoy={hoy}
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
