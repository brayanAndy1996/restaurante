import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import config from '../next.config';
import NoEncontrada from '../app/not-found';
import robots from '../app/robots';

describe('esqueleto de rutas', () => {
  it('la página 404 dice «Esta carta no está disponible»', () => {
    render(<NoEncontrada />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Esta carta no está disponible' }),
    ).toBeInTheDocument();
  });

  it('robots.txt excluye el modo mesa', () => {
    expect(robots().rules).toMatchObject({ allow: '/', disallow: '/m/' });
  });

  it('el modo mesa nunca se guarda, no se indexa y no deja el código en el Referer', async () => {
    const reglas = (await config.headers?.()) ?? [];
    const mesa = reglas.find((regla) => regla.source.startsWith('/m/'));
    const cabeceras = Object.fromEntries((mesa?.headers ?? []).map((h) => [h.key, h.value]));
    expect(cabeceras).toEqual({
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
      'Referrer-Policy': 'no-referrer',
    });
  });

  it('se publica como servidor autónomo', () => {
    expect(config.output).toBe('standalone');
  });
});
