import { describe, expect, it } from 'vitest';
import {
  ACCIONES_LLAMADO,
  CANTIDAD_MAXIMA_LLAMADO,
  ESTADOS_LLAMADO,
  LARGO_NOTA_LLAMADO,
  LIMITE_LLAMADOS_IP,
  LIMITE_LLAMADOS_MESA,
  MAXIMO_LINEAS_LLAMADO,
  MINUTOS_VENCIMIENTO_LLAMADO,
  TIPOS_LLAMADO,
} from '../src';

// Catálogos de los llamados (historia 005, criterios 26, 32, 33 y 56): las constantes que comparten la API,
// los contratos y las pantallas. Las reglas (vencimiento, transiciones, límites) llevan sus propias pruebas.

describe('catálogos de los llamados', () => {
  it('tipos, estados y acciones', () => {
    expect([...TIPOS_LLAMADO]).toEqual(['PEDIDO', 'LLAMAR_MOZO', 'PEDIR_CUENTA']);
    expect([...ESTADOS_LLAMADO]).toEqual([
      'PENDIENTE',
      'ATENDIDO',
      'PASADO_A_CUENTA',
      'DESCARTADO',
      'VENCIDO',
    ]);
    expect([...ACCIONES_LLAMADO]).toEqual(['ATENDER', 'PASAR_A_CUENTA', 'DESCARTAR']);
  });

  it('límites de tamaño y de tiempo', () => {
    expect(MINUTOS_VENCIMIENTO_LLAMADO).toBe(15);
    expect(MAXIMO_LINEAS_LLAMADO).toBe(30);
    expect(CANTIDAD_MAXIMA_LLAMADO).toBe(20);
    expect(LARGO_NOTA_LLAMADO).toBe(140);
  });

  it('límites de creación por mesa y por conexión', () => {
    expect(LIMITE_LLAMADOS_MESA).toEqual({ maximo: 6, ventanaMinutos: 30 });
    expect(LIMITE_LLAMADOS_IP).toEqual({ maximo: 20, ventanaMinutos: 10 });
  });
});
