import { fechaLima, sumarMeses } from '@restaurante/dominio';
import { Aviso, Boton, CampoAreaTexto, CampoTexto, IconoAzar, IconoMas } from '@restaurante/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pagina } from '../../componentes/Pagina';
import { ErrorApi, erroresPorCampo, mensajeDeCampo, mensajeDeError } from '../../lib/errores';
import { fechaLarga } from '../../lib/formato';
import { PinCreadoVista } from '../administracion/PinCreadoVista';
import { generarContrasenaTemporal } from '../administracion/usuarios';
import {
  altaVacia,
  emisorVacio,
  entradaDeAlta,
  sucursalVacia,
  validarAlta,
  type AltaForm,
  type EmisorForm,
  type Errores,
  type SucursalForm,
} from './empresa-form';
import { CamposDeEmisor, CamposDeSucursal } from './campos';
import { CLAVES, listarPlanes, registrarEmpresa } from './plataforma';

interface Resultado {
  empresaId: string;
  nombre: string;
  administrador: { nombre: string; pin: string };
  contrasena: string;
}

/**
 * Alta de empresa (criterio 101): empresa, emisores, sucursales con su plan y vencimiento, y el primer
 * Administrador, con su PIN mostrado una sola vez. Todo o nada: si algo falla, no se crea nada y lo
 * escrito se conserva para corregirlo.
 */
export function EmpresaNuevaPagina() {
  const navegar = useNavigate();
  const clientes = useQueryClient();
  const [form, setForm] = useState<AltaForm>(altaVacia);
  const [errores, setErrores] = useState<Errores>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const hoy = fechaLima(new Date());
  const planes = useQuery({
    queryKey: CLAVES.planes,
    queryFn: ({ signal }) => listarPlanes(signal),
  });
  const planesActivos = (planes.data ?? []).filter((p) => p.activo);

  function cambiar(parcial: Partial<AltaForm>) {
    setForm((f) => ({ ...f, ...parcial }));
  }
  function cambiarEmisor(id: string, parcial: Partial<EmisorForm>) {
    setForm((f) => ({
      ...f,
      emisores: f.emisores.map((e) => (e.id === id ? { ...e, ...parcial } : e)),
    }));
  }
  function cambiarSucursal(id: string, parcial: Partial<SucursalForm>) {
    setForm((f) => ({
      ...f,
      sucursales: f.sucursales.map((s) => (s.id === id ? { ...s, ...parcial } : s)),
    }));
  }
  function quitarEmisor(id: string) {
    setForm((f) => ({
      ...f,
      emisores: f.emisores.filter((e) => e.id !== id),
      // Las sucursales de ese emisor quedan sin emisor hasta que se elija otro.
      sucursales: f.sucursales.map((s) => (s.emisorId === id ? { ...s, emisorId: '' } : s)),
    }));
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    const nuevos = validarAlta(form, hoy);
    setErrores(nuevos);
    setFallo(null);
    if (Object.keys(nuevos).length > 0) return;

    setEnviando(true);
    try {
      const respuesta = await registrarEmpresa(entradaDeAlta(form));
      void clientes.invalidateQueries({ queryKey: CLAVES.empresas });
      setResultado({
        empresaId: respuesta.empresaId,
        nombre: form.nombre.trim(),
        administrador: {
          nombre: form.administrador.nombre.trim(),
          pin: respuesta.administrador.pin,
        },
        contrasena: form.administrador.contrasenaTemporal,
      });
    } catch (e) {
      const error =
        e instanceof ErrorApi
          ? e
          : new ErrorApi({ estado: 0, codigo: 'ERROR_INTERNO', mensaje: '' });
      const campos = erroresPorCampo(error);
      if (error.reintentada && error.codigo !== 'DATOS_INVALIDOS') {
        setFallo(
          'La conexión se cortó mientras se guardaba y es posible que la empresa ya se haya creado. Revisa la lista de empresas antes de intentarlo otra vez.',
        );
      } else if (error.codigo === 'CONFLICTO') {
        setErrores({
          'administrador.nombreUsuario': 'Ese nombre de usuario ya está en uso. Elige otro.',
        });
      } else if (error.codigo === 'PLAN_INVALIDO') {
        setFallo(mensajeDeError(error));
      } else if (error.codigo === 'DATOS_INVALIDOS' && Object.keys(campos).length > 0) {
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

  if (resultado) {
    return (
      <PinCreadoVista
        plataforma
        titulo="Empresa registrada"
        nombre={resultado.administrador.nombre}
        pin={resultado.administrador.pin}
        contrasenaTemporal={resultado.contrasena}
        aviso={{
          titulo: `${resultado.nombre} ya está registrada`,
          texto: `${resultado.administrador.nombre} ingresa con su usuario y la contraseña temporal; luego usa su PIN. Entrégaselos en persona.`,
        }}
        onListo={() => navegar(`/plataforma/empresas/${resultado.empresaId}`, { replace: true })}
      />
    );
  }

  const opcionesDeEmisor = form.emisores.map((e, i) => ({
    id: e.id,
    texto: e.ruc.trim()
      ? `${e.ruc.trim()} · ${e.razonSocial.trim() || 'sin razón social'}`
      : `Emisor ${i + 1}`,
  }));

  return (
    <Pagina
      titulo="Nueva empresa"
      plataforma
      atras={{ a: '/plataforma', etiqueta: 'Empresas' }}
      pie={
        <Boton
          variante="principal"
          bloque
          type="submit"
          form="formulario-empresa"
          cargando={enviando}
          textoCargando="Registrando…"
        >
          Registrar empresa
        </Boton>
      }
    >
      {fallo ? (
        <Aviso tipo="error" titulo="No pudimos registrar la empresa">
          {fallo}
        </Aviso>
      ) : null}

      <form
        id="formulario-empresa"
        className="formulario formulario--secciones"
        onSubmit={enviar}
        noValidate
      >
        <section className="seccion" aria-labelledby="t-empresa">
          <h2 className="formulario__titulo" id="t-empresa">
            Empresa
          </h2>
          <CampoTexto
            etiqueta="Nombre de la empresa"
            value={form.nombre}
            onChange={(e) => cambiar({ nombre: e.target.value })}
            error={errores.nombre}
            autoComplete="off"
          />
        </section>

        <section className="seccion" aria-labelledby="t-emisores">
          <h2 className="formulario__titulo" id="t-emisores">
            Emisores
          </h2>
          <p className="texto-ayuda">
            Cada RUC que emite comprobantes. Una sucursal pertenece a un solo emisor.
          </p>
          {form.emisores.map((e, i) => (
            <div className="ui-bloque" key={e.id} role="group" aria-label={`Emisor ${i + 1}`}>
              <b>{`Emisor ${i + 1}`}</b>
              <CamposDeEmisor
                valor={e}
                onCambio={(parcial) => cambiarEmisor(e.id, parcial)}
                errores={errores}
                prefijo={`emisores.${i}.`}
              />
              {form.emisores.length > 1 ? (
                <Boton onClick={() => quitarEmisor(e.id)}>
                  Quitar este emisor <span className="ui-solo-lectores">{`${i + 1}`}</span>
                </Boton>
              ) : null}
            </div>
          ))}
          <Boton
            icono={IconoMas}
            onClick={() => cambiar({ emisores: [...form.emisores, emisorVacio()] })}
          >
            Agregar otro emisor
          </Boton>
        </section>

        <section className="seccion" aria-labelledby="t-sucursales">
          <h2 className="formulario__titulo" id="t-sucursales">
            Sucursales
          </h2>
          <p className="texto-ayuda">
            Cada sucursal nace con su suscripción. Sin plan elegido usa el plan por defecto, y sin
            vencimiento vence en un mes ({fechaLarga(sumarMeses(hoy, 1))}).
          </p>
          {form.sucursales.map((s, i) => (
            <div className="ui-bloque" key={s.id} role="group" aria-label={`Sucursal ${i + 1}`}>
              <b>{`Sucursal ${i + 1}`}</b>
              <CamposDeSucursal
                valor={s}
                onCambio={(parcial) => cambiarSucursal(s.id, parcial)}
                errores={errores}
                prefijo={`sucursales.${i}.`}
                emisores={opcionesDeEmisor}
                planes={planesActivos}
                hoy={hoy}
              />
              {form.sucursales.length > 1 ? (
                <Boton
                  onClick={() =>
                    cambiar({ sucursales: form.sucursales.filter((x) => x.id !== s.id) })
                  }
                >
                  Quitar esta sucursal <span className="ui-solo-lectores">{`${i + 1}`}</span>
                </Boton>
              ) : null}
            </div>
          ))}
          <Boton
            icono={IconoMas}
            onClick={() =>
              cambiar({
                sucursales: [
                  ...form.sucursales,
                  sucursalVacia(form.emisores.length === 1 ? (form.emisores[0]?.id ?? '') : ''),
                ],
              })
            }
          >
            Agregar otra sucursal
          </Boton>
        </section>

        <section className="seccion" aria-labelledby="t-admin">
          <h2 className="formulario__titulo" id="t-admin">
            Primer administrador
          </h2>
          <p className="texto-ayuda">
            Ingresa con su usuario y la contraseña temporal, y la cambia al entrar. Su PIN de 6
            dígitos lo verás una sola vez al registrar.
          </p>
          <CampoTexto
            etiqueta="Nombre"
            value={form.administrador.nombre}
            onChange={(e) =>
              cambiar({ administrador: { ...form.administrador, nombre: e.target.value } })
            }
            error={errores['administrador.nombre']}
            autoComplete="off"
          />
          <CampoTexto
            etiqueta="Nombre de usuario"
            value={form.administrador.nombreUsuario}
            onChange={(e) =>
              cambiar({ administrador: { ...form.administrador, nombreUsuario: e.target.value } })
            }
            error={errores['administrador.nombreUsuario']}
            ayuda="Con este usuario ingresará. No se puede cambiar después."
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="formulario__grupo">
            <CampoTexto
              etiqueta="Contraseña temporal"
              value={form.administrador.contrasenaTemporal}
              onChange={(e) =>
                cambiar({
                  administrador: { ...form.administrador, contrasenaTemporal: e.target.value },
                })
              }
              error={errores['administrador.contrasenaTemporal']}
              ayuda="Al menos 8 caracteres. Entrégala en persona."
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <Boton
              icono={IconoAzar}
              onClick={() =>
                cambiar({
                  administrador: {
                    ...form.administrador,
                    contrasenaTemporal: generarContrasenaTemporal(),
                  },
                })
              }
            >
              Generar una contraseña
            </Boton>
          </div>
        </section>

        <section className="seccion" aria-labelledby="t-motivo">
          <h2 className="formulario__titulo" id="t-motivo">
            Auditoría
          </h2>
          <CampoAreaTexto
            etiqueta="Motivo del alta"
            value={form.motivo}
            onChange={(e) => cambiar({ motivo: e.target.value })}
            error={errores.motivo}
            ayuda="Queda registrado con tu nombre. Por ejemplo: cliente nuevo, contrato firmado el 27/10."
            maxLength={300}
            rows={2}
          />
        </section>
      </form>
    </Pagina>
  );
}
