import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Boton, CampoContrasena, CampoTexto, Interruptor } from '../src';

describe('Boton', () => {
  it('con cargando se desactiva, muestra el texto de carga y se anuncia ocupado', () => {
    render(
      <Boton cargando textoCargando="Ingresando…">
        Ingresar
      </Boton>,
    );
    const boton = screen.getByRole('button', { name: 'Ingresando…' });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute('aria-busy', 'true');
  });

  it('no dispara onClick mientras carga', async () => {
    const alTocar = vi.fn();
    render(
      <Boton cargando onClick={alTocar}>
        Guardar
      </Boton>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(alTocar).not.toHaveBeenCalled();
  });
});

describe('CampoTexto', () => {
  it('asocia la etiqueta visible con el campo', () => {
    render(<CampoTexto etiqueta="Usuario" />);
    expect(screen.getByLabelText('Usuario')).toBeInTheDocument();
  });

  it('con error marca el campo como inválido y anuncia el mensaje', () => {
    render(<CampoTexto etiqueta="Usuario" error="Escribe tu usuario" ayuda="Sin espacios" />);
    const campo = screen.getByLabelText('Usuario');
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe tu usuario');
    expect(campo.getAttribute('aria-describedby')).toContain('-ayuda');
    expect(campo.getAttribute('aria-describedby')).toContain('-error');
  });

  it('marca "(opcional)" en la etiqueta', () => {
    render(<CampoTexto etiqueta="Referencia" opcional />);
    expect(screen.getByText('(opcional)', { exact: false })).toBeInTheDocument();
  });
});

describe('CampoContrasena', () => {
  it('oculta la contraseña y el ojo la muestra y la vuelve a ocultar', async () => {
    render(<CampoContrasena etiqueta="Contraseña" autoComplete="current-password" />);
    const campo = screen.getByLabelText('Contraseña');
    expect(campo).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(campo).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(campo).toHaveAttribute('type', 'password');
  });

  it('conserva el autocomplete que indica quien la usa', () => {
    render(<CampoContrasena etiqueta="Nueva" autoComplete="new-password" />);
    expect(screen.getByLabelText('Nueva')).toHaveAttribute('autocomplete', 'new-password');
  });
});

describe('Interruptor', () => {
  function Prueba() {
    const [marcado, setMarcado] = useState(false);
    return <Interruptor etiqueta="Limitar horario" marcado={marcado} onCambio={setMarcado} />;
  }

  it('es un switch que cambia con un toque', async () => {
    render(<Prueba />);
    const interruptor = screen.getByRole('switch', { name: 'Limitar horario' });
    expect(interruptor).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(interruptor);
    expect(interruptor).toHaveAttribute('aria-checked', 'true');
  });
});
