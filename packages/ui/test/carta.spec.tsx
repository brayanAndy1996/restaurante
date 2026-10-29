import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Casilla,
  CampoMonto,
  ContadorGrande,
  ContenidoDeFila,
  FilaOrdenable,
  Miniatura,
  OpcionesConAyuda,
  Plegable,
  SelectorDeCantidad,
  SelectorDeFoto,
  completarMontoEscrito,
  limpiarMontoEscrito,
  moverEnLista,
} from '../src';

describe('limpiarMontoEscrito y completarMontoEscrito', () => {
  it('deja solo dígitos y un separador, con la coma convertida en punto', () => {
    expect(limpiarMontoEscrito('S/ 28,5')).toBe('28.5');
    expect(limpiarMontoEscrito('1e5')).toBe('15');
    expect(limpiarMontoEscrito('-12')).toBe('12');
    expect(limpiarMontoEscrito('1.2.3')).toBe('1.23');
  });

  it('recorta a 8 enteros y 2 decimales', () => {
    expect(limpiarMontoEscrito('123456789')).toBe('12345678');
    expect(limpiarMontoEscrito('12.3456')).toBe('12.34');
  });

  it('al pegar un monto con miles ("1,234.50") descarta las comas de miles en vez de truncarlo', () => {
    expect(limpiarMontoEscrito('1,234.50')).toBe('1234.50');
    expect(limpiarMontoEscrito('S/ 1,234.5')).toBe('1234.5');
    expect(limpiarMontoEscrito('12,345,678')).toBe('12345678');
    expect(limpiarMontoEscrito('1,234,567.8')).toBe('1234567.8');
  });

  it('si no se sabe cuál es el decimal ("1.234,50", "1,2.50") deja el texto para que la validación avise', () => {
    expect(limpiarMontoEscrito('1.234,50')).toBe('1.234,50');
    expect(limpiarMontoEscrito('S/ 1,2.50')).toBe('1,2.50');
    expect(limpiarMontoEscrito('12,34.5,6')).toBe('12,34.5,6');
    // Lo que queda no es un monto: ni se completa a 2 decimales ni se acepta.
    expect(completarMontoEscrito('1.234,50')).toBe('1.234,50');
  });

  it('una sola coma sigue siendo el decimal del teclado del celular', () => {
    expect(limpiarMontoEscrito('28,5')).toBe('28.5');
    expect(limpiarMontoEscrito('1,234')).toBe('1.23');
    expect(limpiarMontoEscrito('28,')).toBe('28.');
  });

  it('completa a 2 decimales sin pasar por números de coma flotante', () => {
    expect(completarMontoEscrito('28')).toBe('28.00');
    expect(completarMontoEscrito('28.5')).toBe('28.50');
    expect(completarMontoEscrito('28.')).toBe('28.00');
    expect(completarMontoEscrito('.5')).toBe('0.50');
    expect(completarMontoEscrito('0.1')).toBe('0.10');
    expect(completarMontoEscrito('')).toBe('');
    expect(completarMontoEscrito('.')).toBe('.');
  });
});

describe('CampoMonto', () => {
  function Prueba({ inicial = '' }: { inicial?: string }) {
    const [valor, setValor] = useState(inicial);
    return <CampoMonto etiqueta="Precio" value={valor} onValor={setValor} error={undefined} />;
  }

  it('lleva S/ delante, teclado decimal y no deja escribir letras', async () => {
    render(<Prueba />);
    const campo = screen.getByLabelText('Precio');
    expect(campo).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByText('S/')).toBeInTheDocument();
    await userEvent.type(campo, 'a2b8,5x');
    expect(campo).toHaveValue('28.5');
  });

  it('al pegar "1,234.50" queda 1234.50; al pegar "1.234,50" queda tal cual, sin cambiar el valor', async () => {
    render(<Prueba />);
    const campo = screen.getByLabelText('Precio');
    await userEvent.click(campo);
    await userEvent.paste('1,234.50');
    expect(campo).toHaveValue('1234.50');
    await userEvent.clear(campo);
    await userEvent.paste('1.234,50');
    expect(campo).toHaveValue('1.234,50');
    // Al salir no lo "arregla": queda para que la validación del formulario avise.
    await userEvent.tab();
    expect(campo).toHaveValue('1.234,50');
  });

  it('al salir completa los 2 decimales', async () => {
    render(<Prueba />);
    await userEvent.type(screen.getByLabelText('Precio'), '28');
    await userEvent.tab();
    expect(screen.getByLabelText('Precio')).toHaveValue('28.00');
  });
});

describe('Casilla', () => {
  it('cambia con un toque en toda la fila', async () => {
    const alCambiar = vi.fn();
    render(<Casilla etiqueta="Miraflores" marcada={true} onCambio={alCambiar} />);
    await userEvent.click(screen.getByText('Miraflores'));
    expect(alCambiar).toHaveBeenCalledWith(false);
  });

  it('bloqueada no cambia y dice por qué', async () => {
    const alCambiar = vi.fn();
    render(
      <Casilla
        etiqueta="Surco"
        ayuda="Solo la cambia un Cajero de esta sucursal"
        marcada
        bloqueada
        onCambio={alCambiar}
      />,
    );
    const casilla = screen.getByRole('checkbox', { name: /Surco/ });
    expect(casilla).toBeDisabled();
    expect(casilla).toBeChecked();
    expect(casilla).toHaveAccessibleDescription('Solo la cambia un Cajero de esta sucursal');
    await userEvent.click(screen.getByText('Surco'));
    expect(alCambiar).not.toHaveBeenCalled();
  });
});

describe('OpcionesConAyuda', () => {
  const opciones = [
    { valor: 'UNIDADES', titulo: 'Por unidades', ayuda: 'Cada venta resta una unidad' },
    { valor: 'SIN_CONTROL', titulo: 'Sin control', ayuda: 'No se lleva stock' },
  ] as const;

  it('es un grupo de radios con la ayuda de cada opción', async () => {
    const alCambiar = vi.fn();
    render(
      <OpcionesConAyuda
        etiqueta="Control de stock"
        opciones={opciones}
        valor=""
        onCambio={alCambiar}
      />,
    );
    const grupo = screen.getByRole('group', { name: 'Control de stock' });
    expect(grupo).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByText('Cada venta resta una unidad')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Sin control/ }));
    expect(alCambiar).toHaveBeenCalledWith('SIN_CONTROL');
  });

  it('una opción deshabilitada se ve, no se puede elegir y dice por qué', async () => {
    const alCambiar = vi.fn();
    render(
      <OpcionesConAyuda
        etiqueta="Bebida"
        opciones={[
          { valor: 'chicha', titulo: 'Chicha morada', ayuda: 'Sin recargo' },
          { valor: 'cerveza', titulo: 'Cerveza', ayuda: 'No disponible', deshabilitada: true },
        ]}
        valor=""
        onCambio={alCambiar}
      />,
    );
    const cerveza = screen.getByRole('radio', { name: /Cerveza/ });
    expect(cerveza).toBeDisabled();
    expect(screen.getByText('No disponible')).toBeVisible();
    await userEvent.click(cerveza);
    expect(alCambiar).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('radio', { name: /Chicha morada/ }));
    expect(alCambiar).toHaveBeenCalledWith('chicha');
  });

  it('marca la elegida y anuncia el error', () => {
    render(
      <OpcionesConAyuda
        etiqueta="Control de stock"
        opciones={opciones}
        valor="UNIDADES"
        onCambio={() => undefined}
        error="Elige cómo se controla"
      />,
    );
    expect(screen.getByRole('radio', { name: /Por unidades/ })).toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent('Elige cómo se controla');
  });
});

describe('Plegable', () => {
  it('oculta su contenido hasta abrirlo y se anuncia expandido o no', async () => {
    function Prueba() {
      const [abierto, setAbierto] = useState(false);
      return (
        <Plegable
          titulo="Datos tributarios"
          resumen="Gravado"
          abierto={abierto}
          onCambio={setAbierto}
        >
          <p>Afectación</p>
        </Plegable>
      );
    }
    render(<Prueba />);
    const boton = screen.getByRole('button', { name: /Datos tributarios/ });
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Afectación')).not.toBeVisible();
    expect(screen.getByText('Gravado')).toBeVisible();
    await userEvent.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Afectación')).toBeVisible();
  });
});

describe('FilaOrdenable y moverEnLista', () => {
  it('moverEnLista no cambia la lista original', () => {
    const lista = ['a', 'b', 'c'];
    expect(moverEnLista(lista, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moverEnLista(lista, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moverEnLista(lista, 1, 1)).toEqual(['a', 'b', 'c']);
    expect(moverEnLista(lista, 0, -1)).toEqual(['a', 'b', 'c']);
    expect(lista).toEqual(['a', 'b', 'c']);
  });

  it('sube y baja con botones que dicen qué mueven; en el extremo no hacen nada pero siguen enfocables', async () => {
    const subir = vi.fn();
    const bajar = vi.fn();
    render(
      <ul>
        <FilaOrdenable nombre="Entradas" posicion={1} total={3} onSubir={subir} onBajar={bajar}>
          Entradas
        </FilaOrdenable>
      </ul>,
    );
    const arriba = screen.getByRole('button', { name: 'Subir Entradas' });
    const abajo = screen.getByRole('button', { name: 'Bajar Entradas' });
    expect(arriba).toHaveAttribute('aria-disabled', 'true');
    expect(arriba).not.toBeDisabled();
    await userEvent.click(arriba);
    expect(subir).not.toHaveBeenCalled();
    await userEvent.click(abajo);
    expect(bajar).toHaveBeenCalledTimes(1);
  });
});

describe('Miniatura y ContenidoDeFila', () => {
  it('sin foto deja una baldosa vacía y con foto la carga perezosa', () => {
    const { container, rerender } = render(<Miniatura url={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.ui-miniatura--vacia')).not.toBeNull();
    rerender(<Miniatura url="https://fotos.prueba/a.jpg" />);
    const imagen = container.querySelector('img');
    expect(imagen).toHaveAttribute('loading', 'lazy');
    expect(imagen).toHaveAttribute('alt', '');
    fireEvent.error(imagen as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
  });

  it('la fila usa lo que se le pone a la izquierda en lugar de la inicial', () => {
    const { container } = render(
      <ContenidoDeFila izquierda={<Miniatura url={null} />} inicial="Ceviche" titulo="Ceviche" />,
    );
    expect(container.querySelector('.ui-inicial')).toBeNull();
    expect(container.querySelector('.ui-miniatura')).not.toBeNull();
  });
});

describe('SelectorDeFoto', () => {
  const base = { nombre: 'Ceviche', url: null, estado: 'reposo' as const, onElegir: vi.fn() };

  it('sin foto ofrece tomar o elegir y entrega el archivo elegido', async () => {
    const alElegir = vi.fn();
    render(<SelectorDeFoto {...base} onElegir={alElegir} />);
    expect(screen.getByText('Sin foto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tomar o elegir foto' })).toBeInTheDocument();
    const archivo = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText('Elegir foto de Ceviche'), archivo);
    expect(alElegir).toHaveBeenCalledWith(archivo);
  });

  it('con foto la muestra y ofrece cambiarla o quitarla', async () => {
    const alQuitar = vi.fn();
    render(<SelectorDeFoto {...base} url="https://fotos.prueba/a.jpg" onQuitar={alQuitar} />);
    expect(screen.getByRole('img', { name: 'Foto de Ceviche' })).toHaveAttribute(
      'src',
      'https://fotos.prueba/a.jpg',
    );
    expect(screen.getByRole('button', { name: 'Cambiar foto' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Quitar foto' }));
    expect(alQuitar).toHaveBeenCalled();
  });

  it('mientras trabaja lo dice con palabras y no deja elegir otra', () => {
    render(<SelectorDeFoto {...base} estado="subiendo" vistaPrevia="blob:x" detalle="230 KB" />);
    expect(screen.getByRole('status')).toHaveTextContent('Subiendo la foto… 230 KB');
    expect(screen.getByRole('button', { name: 'Cambiar foto' })).toBeDisabled();
  });

  it('si falla conserva la vista previa y ofrece reintentar', async () => {
    const alReintentar = vi.fn();
    render(
      <SelectorDeFoto
        {...base}
        estado="error"
        vistaPrevia="blob:x"
        error="No hay conexión. Tu foto sigue aquí."
        onReintentar={alReintentar}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Tu foto sigue aquí');
    expect(screen.getByRole('img', { name: 'Foto de Ceviche' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(alReintentar).toHaveBeenCalled();
  });
});

describe('SelectorDeCantidad', () => {
  function Prueba({ inicial = 2, maximo = 3 }: { inicial?: number; maximo?: number }) {
    const [valor, setValor] = useState(inicial);
    return <SelectorDeCantidad nombre="Papas" valor={valor} maximo={maximo} onCambio={setValor} />;
  }

  it('suma y resta de a una unidad y dice la cantidad en el grupo', async () => {
    render(<Prueba />);
    expect(screen.getByRole('group', { name: 'Cantidad de Papas' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('× 2');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar una unidad de Papas' }));
    expect(screen.getByRole('status')).toHaveTextContent('× 3');
    await userEvent.click(screen.getByRole('button', { name: 'Quitar una unidad de Papas' }));
    expect(screen.getByRole('status')).toHaveTextContent('× 2');
  });

  it('en los extremos el botón no hace nada y queda marcado, sin perder el foco', async () => {
    render(<Prueba inicial={3} />);
    const mas = screen.getByRole('button', { name: 'Agregar una unidad de Papas' });
    expect(mas).toHaveAttribute('aria-disabled', 'true');
    expect(mas).not.toBeDisabled();
    await userEvent.click(mas);
    expect(screen.getByRole('status')).toHaveTextContent('× 3');
  });

  it('no baja del mínimo', async () => {
    render(<Prueba inicial={1} />);
    const menos = screen.getByRole('button', { name: 'Quitar una unidad de Papas' });
    expect(menos).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(menos);
    expect(screen.getByRole('status')).toHaveTextContent('× 1');
  });
});

describe('ContadorGrande', () => {
  function Prueba({ inicial = 4, maximo = 6 }: { inicial?: number; maximo?: number }) {
    const [valor, setValor] = useState(inicial);
    return (
      <ContadorGrande
        nombre="comensales"
        unidad="comensales"
        valor={valor}
        maximo={maximo}
        onCambio={setValor}
      />
    );
  }

  it('suma y resta de a uno y anuncia el número', async () => {
    render(<Prueba />);
    expect(screen.getByRole('group', { name: 'Cantidad de comensales' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('4');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar uno a comensales' }));
    expect(screen.getByRole('status')).toHaveTextContent('5');
    await userEvent.click(screen.getByRole('button', { name: 'Quitar uno de comensales' }));
    await userEvent.click(screen.getByRole('button', { name: 'Quitar uno de comensales' }));
    expect(screen.getByRole('status')).toHaveTextContent('3');
  });

  it('no pasa de sus extremos y el botón queda marcado sin perder el foco', async () => {
    render(<Prueba inicial={6} />);
    const mas = screen.getByRole('button', { name: 'Agregar uno a comensales' });
    expect(mas).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(mas);
    expect(screen.getByRole('status')).toHaveTextContent('6');
  });

  it('no baja del mínimo de uno', async () => {
    render(<Prueba inicial={1} />);
    const menos = screen.getByRole('button', { name: 'Quitar uno de comensales' });
    expect(menos).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(menos);
    expect(screen.getByRole('status')).toHaveTextContent('1');
  });
});
