import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Aviso,
  BarraDeSesion,
  Cenefa,
  ContenidoDeFila,
  DialogoConfirmacion,
  EsqueletoDeLista,
  EstadoVacio,
  ErrorDeCarga,
  Hoja,
  IconoSalir,
  IconoUsuarios,
  Segmentos,
  TablaResponsiva,
} from '../src';

function EnTablet(coincide: boolean) {
  window.matchMedia = ((consulta: string) =>
    ({
      matches: coincide,
      media: consulta,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

describe('Hoja', () => {
  function Prueba() {
    const [abierta, setAbierta] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setAbierta(true)}>
          Abrir
        </button>
        <Hoja abierta={abierta} onCerrar={() => setAbierta(false)} titulo="Clave">
          <input aria-label="Motivo" />
        </Hoja>
      </>
    );
  }

  it('solo tiene contenido mientras está abierta y se cierra con el botón', async () => {
    render(<Prueba />);
    expect(screen.queryByLabelText('Motivo')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(screen.getByRole('heading', { name: 'Clave' })).toBeInTheDocument();
    expect(screen.getByLabelText('Motivo')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByLabelText('Motivo')).toBeNull();
  });
});

describe('DialogoConfirmacion', () => {
  it('dice qué pasará y el foco empieza en Cancelar', () => {
    render(
      <DialogoConfirmacion
        abierta
        titulo="Desactivar a Rosa"
        etiquetaConfirmar="Desactivar"
        peligro
        onConfirmar={() => undefined}
        onCancelar={() => undefined}
      >
        Se cerrarán sus sesiones abiertas.
      </DialogoConfirmacion>,
    );
    expect(screen.getByText('Se cerrarán sus sesiones abiertas.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  it('confirma y cancela', async () => {
    const confirmar = vi.fn();
    const cancelar = vi.fn();
    render(
      <DialogoConfirmacion
        abierta
        titulo="Salir"
        etiquetaConfirmar="Salir"
        onConfirmar={confirmar}
        onCancelar={cancelar}
      >
        Saldrás de tu sesión.
      </DialogoConfirmacion>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(confirmar).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(cancelar).toHaveBeenCalled();
  });
});

describe('Aviso', () => {
  it('el error se anuncia como alerta y lo demás como estado', () => {
    render(
      <>
        <Aviso tipo="error" titulo="No pudimos ingresarte">
          Revisa tus datos.
        </Aviso>
        <Aviso tipo="info">Primera vez en este celular.</Aviso>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos ingresarte');
    expect(screen.getByRole('status')).toHaveTextContent('Primera vez');
  });
});

describe('Cenefa', () => {
  it('lleva el estado en un atributo y no la leen los lectores de pantalla', () => {
    const { container } = render(<Cenefa estado="soporte" />);
    const cenefa = container.querySelector('.ui-cenefa');
    expect(cenefa).toHaveAttribute('data-estado', 'soporte');
    expect(cenefa).toHaveAttribute('aria-hidden', 'true');
  });

  it('al cambiar de estado agrega la capa que se llena', () => {
    const { container, rerender } = render(<Cenefa estado="normal" />);
    expect(container.querySelector('.ui-cenefa__llenado')).toBeNull();
    rerender(<Cenefa estado="sin-conexion" />);
    expect(container.querySelector('.ui-cenefa__llenado')).not.toBeNull();
  });
});

describe('Estados', () => {
  it('el vacío dice qué falta y ofrece la acción', () => {
    render(
      <EstadoVacio
        icono={IconoUsuarios}
        titulo="Aún no hay usuarios"
        accion={<button type="button">Agregar usuario</button>}
      >
        Agrega a tu primer trabajador.
      </EstadoVacio>,
    );
    expect(screen.getByText('Aún no hay usuarios')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar usuario' })).toBeInTheDocument();
  });

  it('el error de carga ofrece Reintentar en la misma pantalla', async () => {
    const reintentar = vi.fn();
    render(
      <ErrorDeCarga titulo="No pudimos cargar los usuarios" onReintentar={reintentar}>
        Revisa tu conexión.
      </ErrorDeCarga>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(reintentar).toHaveBeenCalledTimes(1);
  });

  it('el esqueleto avisa pasados 8 segundos', async () => {
    vi.useFakeTimers();
    try {
      render(<EsqueletoDeLista />);
      expect(screen.queryByText(/tarda más de lo normal/)).toBeNull();
      act(() => {
        vi.advanceTimersByTime(8100);
      });
      expect(
        screen.getByText('Esto tarda más de lo normal. Seguimos intentando.'),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('TablaResponsiva', () => {
  const filas = [
    { id: '1', nombre: 'Rosa', rol: 'Mozo' },
    { id: '2', nombre: 'Luis', rol: 'Cajero' },
  ];
  const props = {
    etiqueta: 'Usuarios',
    filas,
    clave: (f: (typeof filas)[number]) => f.id,
    columnas: [
      { id: 'n', encabezado: 'Nombre', celda: (f: (typeof filas)[number]) => f.nombre },
      { id: 'r', encabezado: 'Rol', celda: (f: (typeof filas)[number]) => f.rol },
    ],
    filaEnLista: (f: (typeof filas)[number]) => <ContenidoDeFila titulo={f.nombre} ayuda={f.rol} />,
  };

  it('en celular es una lista de filas', () => {
    EnTablet(false);
    render(<TablaResponsiva {...props} />);
    expect(screen.getByRole('list', { name: 'Usuarios' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('desde 768 px es una tabla con encabezados', () => {
    EnTablet(true);
    render(<TablaResponsiva {...props} />);
    expect(screen.getByRole('table', { name: 'Usuarios' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Rol' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    EnTablet(false);
  });
});

describe('BarraDeSesion', () => {
  it('muestra la sucursal y abre la hoja de la sesión con sus acciones', async () => {
    const salir = vi.fn();
    render(
      <BarraDeSesion
        persona={{ nombre: 'Rosa Quispe', detalle: 'Mozo' }}
        sucursal={{ id: 's1', nombre: 'Miraflores' }}
        sucursales={[{ id: 's1', nombre: 'Miraflores' }]}
        onElegirSucursal={() => undefined}
        acciones={[
          {
            id: 'salir',
            etiqueta: 'Salir',
            icono: IconoSalir,
            peligro: true,
            onSeleccionar: salir,
          },
        ]}
      />,
    );
    expect(screen.getByText('Miraflores')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sesión de Rosa Quispe' }));
    expect(screen.getByRole('heading', { name: 'Tu sesión' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cambiar de sucursal' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(salir).toHaveBeenCalledTimes(1);
  });

  it('pone primero la acción principal y separa las que cierran o destruyen', async () => {
    render(
      <BarraDeSesion
        persona={{ nombre: 'Rosa Quispe', detalle: 'Mozo' }}
        sucursal={{ id: 's1', nombre: 'Miraflores' }}
        sucursales={[{ id: 's1', nombre: 'Miraflores' }]}
        onElegirSucursal={() => undefined}
        acciones={[
          {
            id: 'mis',
            etiqueta: 'Mis equipos',
            icono: IconoUsuarios,
            onSeleccionar: () => undefined,
          },
          {
            id: 'cambiar',
            etiqueta: 'Cambiar usuario',
            icono: IconoUsuarios,
            principal: true,
            onSeleccionar: () => undefined,
          },
          {
            id: 'olvidar',
            etiqueta: 'Olvidar este equipo',
            icono: IconoSalir,
            peligro: true,
            onSeleccionar: () => undefined,
          },
          {
            id: 'salir',
            etiqueta: 'Salir',
            icono: IconoSalir,
            peligro: true,
            onSeleccionar: () => undefined,
          },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sesión de Rosa Quispe' }));
    const botones = screen.getAllByRole('button').map((b) => b.textContent);
    expect(botones.indexOf('Cambiar usuario')).toBeLessThan(botones.indexOf('Mis equipos'));
    expect(botones.indexOf('Mis equipos')).toBeLessThan(botones.indexOf('Olvidar este equipo'));
    expect(screen.getByRole('button', { name: 'Cambiar usuario' })).toHaveClass(
      'ui-boton--principal',
    );
    expect(screen.getByRole('button', { name: 'Salir' })).toHaveClass('ui-boton--peligro');
    expect(
      screen.getByRole('button', { name: 'Salir' }).closest('.ui-acciones__separada'),
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Mis equipos' }).closest('.ui-acciones__separada'),
    ).toBeNull();
  });

  it('con varias sucursales permite cambiar y no repite la activa', async () => {
    const elegir = vi.fn();
    render(
      <BarraDeSesion
        persona={{ nombre: 'Marta', detalle: 'Administrador' }}
        sucursal={{ id: 's1', nombre: 'Miraflores' }}
        sucursales={[
          { id: 's1', nombre: 'Miraflores' },
          { id: 's2', nombre: 'Surco', detalle: 'Cajero' },
        ]}
        onElegirSucursal={elegir}
        acciones={[]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Miraflores/ }));
    await userEvent.click(screen.getByRole('button', { name: /Surco/ }));
    expect(elegir).toHaveBeenCalledWith('s2');
  });
});

describe('Segmentos', () => {
  const opciones = [
    { valor: 'todas', etiqueta: 'Todas' },
    { valor: 'activas', etiqueta: 'Activas' },
  ] as const;

  it('marca la opción elegida y avisa al elegir otra', async () => {
    const alCambiar = vi.fn();
    render(<Segmentos etiqueta="Filtrar" opciones={opciones} valor="todas" onCambio={alCambiar} />);
    expect(screen.getByRole('group', { name: 'Filtrar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Activas' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Activas' }));
    expect(alCambiar).toHaveBeenCalledWith('activas');
  });

  it('no repite el aviso al tocar la opción que ya está elegida', async () => {
    const alCambiar = vi.fn();
    render(<Segmentos etiqueta="Filtrar" opciones={opciones} valor="todas" onCambio={alCambiar} />);
    await userEvent.click(screen.getByRole('button', { name: 'Todas' }));
    expect(alCambiar).not.toHaveBeenCalled();
  });
});
