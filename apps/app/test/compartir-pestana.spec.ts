import { afterEach, describe, expect, it, vi } from 'vitest';
import { abrirPestanaEnBlanco, llevarPestana } from '../src/modulos/facturacion/compartir';

// spec: 006-caja-cobro, criterio 161 (revisión T48): la pestaña que se abre para el PDF o para wa.me no conserva
// `window.opener`, así la página de destino no puede volver a la PWA.

afterEach(() => vi.restoreAllMocks());

function ventanaFalsa() {
  return { opener: { es: 'la PWA' }, closed: false, location: { href: '' } } as unknown as Window;
}

describe('Las pestañas de «Ver PDF» y «Compartir por WhatsApp» no conservan window.opener', () => {
  it('la pestaña en blanco se abre sin opener', () => {
    const ventana = ventanaFalsa();
    vi.spyOn(window, 'open').mockReturnValue(ventana);
    expect(abrirPestanaEnBlanco()).toBe(ventana);
    expect(ventana.opener).toBeNull();
  });

  it('se la lleva al destino con el opener ya cortado', () => {
    const ventana = ventanaFalsa();
    vi.spyOn(window, 'open').mockReturnValue(ventana);
    const pestana = abrirPestanaEnBlanco();
    expect(llevarPestana(pestana, 'https://wa.me/?text=hola')).toBe(true);
    expect(ventana.opener).toBeNull();
    expect(ventana.location.href).toBe('https://wa.me/?text=hola');
  });

  it('si no hubo pestaña previa, la nueva que se abre tampoco lleva opener', () => {
    const nueva = ventanaFalsa();
    const abrir = vi.spyOn(window, 'open').mockReturnValue(nueva);
    expect(llevarPestana(null, 'blob:http://localhost/x')).toBe(true);
    expect(abrir).toHaveBeenCalledWith('blob:http://localhost/x', '_blank');
    expect(nueva.opener).toBeNull();
  });

  it('un navegador que bloquea la pestaña lo dice (false) y no falla', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(abrirPestanaEnBlanco()).toBeNull();
    expect(llevarPestana(null, 'https://wa.me/')).toBe(false);
  });
});
