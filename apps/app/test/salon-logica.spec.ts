import type { UsuarioRespuesta } from '@restaurante/contratos';
import { describe, expect, it } from 'vitest';
import { personasQueAtienden } from '../src/modulos/salon/personas';
import {
  CELDA_MAXIMA,
  CELDA_MINIMA,
  ahoraDelSalon,
  ayudaDeFila,
  cabeElMapa,
  contarEstados,
  detalleDeMesa,
  grupoDeMesa,
  gruposDeZona,
  ladoDeCelda,
  mesasDeCuadricula,
  mesasEnOrdenDeLectura,
  minutosAbierta,
  textoDeConteo,
  textoDeDuracion,
  totalDeMesa,
  type SalonEnCache,
} from '../src/modulos/salon/salon';
import { AHORA, mesa, salon, uuid, zona } from './ayudas-salon';

// spec: 004-salon-cocina, criterios 7, 8, 10 y 88 (presentación del mapa; pruebas no protegidas).

const ahora = Date.parse(AHORA);

describe('tiempo abierta', () => {
  it('dice minutos y, desde una hora, horas y minutos', () => {
    expect(textoDeDuracion(0)).toBe('0 min');
    expect(textoDeDuracion(25)).toBe('25 min');
    expect(textoDeDuracion(59)).toBe('59 min');
    expect(textoDeDuracion(60)).toBe('1 h 00 min');
    expect(textoDeDuracion(125)).toBe('2 h 05 min');
    expect(textoDeDuracion(-3)).toBe('0 min');
  });

  it('cuenta con la hora del servidor y nunca sale negativo', () => {
    expect(minutosAbierta('2026-10-29T16:35:00.000Z', ahora)).toBe(25);
    expect(minutosAbierta('2026-10-29T16:35:30.000Z', ahora)).toBe(24);
    expect(minutosAbierta('2026-10-29T17:10:00.000Z', ahora)).toBe(0);
  });

  it('la hora del salón es la del servidor más lo que pasó en este equipo, sin fiarse del reloj del equipo', () => {
    const datos = {
      ahoraDelServidorMs: ahora,
      recibidoEnMs: 5_000_000,
    } as SalonEnCache;
    // El reloj del equipo va desfasado (5 000 000 ms): lo que cuenta es lo que transcurrió.
    expect(ahoraDelSalon(datos, 5_000_000 + 120_000)).toBe(ahora + 120_000);
    // Un reloj que retrocede no hace retroceder el tiempo.
    expect(ahoraDelSalon(datos, 4_000_000)).toBe(ahora);
    expect(ahoraDelSalon(undefined, 42)).toBe(42);
  });
});

describe('estado y detalle de cada mesa (criterio 88)', () => {
  it('una mesa libre no lleva detalle ni grupo', () => {
    const libre = mesa(1, '1');
    expect(detalleDeMesa(libre, ahora)).toBeUndefined();
    expect(grupoDeMesa(libre)).toBeUndefined();
  });

  it('una ocupada dice comensales y minutos: "3 · 25 min"', () => {
    const ocupada = mesa(1, '1', { orden: { comensales: 3, minutos: 25 } });
    expect(detalleDeMesa(ocupada, ahora)).toBe('3 · 25 min');
  });

  it('las mesas unidas dicen con cuáles: "Grupo con 5, 6" (sin repetirse a sí misma)', () => {
    const unidas = [
      { id: uuid(104), nombre: '4' },
      { id: uuid(105), nombre: '5' },
      { id: uuid(106), nombre: '6' },
    ];
    const cuatro = mesa(4, '4', { orden: { mesas: unidas } });
    const cinco = mesa(5, '5', { orden: { mesas: unidas } });
    expect(grupoDeMesa(cuatro)).toBe('5, 6');
    expect(grupoDeMesa(cinco)).toBe('4, 6');
  });

  it('arma las mesas de la cuadrícula con estado, detalle y grupo', () => {
    const unidas = [
      { id: uuid(101), nombre: '1' },
      { id: uuid(102), nombre: '2' },
    ];
    const z = zona(uuid(1), 'Salón', [
      mesa(1, '1', { orden: { mesas: unidas } }),
      mesa(2, '2', { estado: 'EN_PRECUENTA', orden: { mesas: unidas, minutos: 70 } }),
      mesa(3, '3'),
    ]);
    const [uno, dos, tres] = mesasDeCuadricula(z, ahora);
    expect(uno).toMatchObject({ estado: 'OCUPADA', detalle: '3 · 25 min', grupo: '2' });
    expect(dos).toMatchObject({ estado: 'EN_PRECUENTA', detalle: '3 · 1 h 10 min', grupo: '1' });
    expect(tres).toMatchObject({ estado: 'LIBRE' });
    expect(tres).not.toHaveProperty('detalle');
    expect(tres).not.toHaveProperty('grupo');
  });

  it('cuenta las mesas por estado y lo dice en singular o plural', () => {
    const mesas = [
      mesa(1, '1'),
      mesa(2, '2'),
      mesa(3, '3', { orden: {} }),
      mesa(4, '4', { estado: 'EN_PRECUENTA', orden: {} }),
    ];
    expect(contarEstados(mesas)).toEqual({ LIBRE: 2, OCUPADA: 1, EN_PRECUENTA: 1 });
    expect(textoDeConteo('LIBRE', 2)).toBe('2 libres');
    expect(textoDeConteo('LIBRE', 1)).toBe('1 libre');
    expect(textoDeConteo('OCUPADA', 0)).toBe('0 ocupadas');
    expect(textoDeConteo('OCUPADA', 1)).toBe('1 ocupada');
    expect(textoDeConteo('EN_PRECUENTA', 3)).toBe('3 en pre-cuenta');
  });

  it('lista cada cuenta unida una sola vez', () => {
    const unidas = [
      { id: uuid(104), nombre: '4' },
      { id: uuid(105), nombre: '5' },
      { id: uuid(106), nombre: '6' },
    ];
    const z = zona(uuid(1), 'Salón', [
      mesa(4, '4', { orden: { id: uuid(777), mesas: unidas } }),
      mesa(5, '5', { orden: { id: uuid(777), mesas: unidas } }),
      mesa(7, '7', { orden: {} }),
      mesa(8, '8'),
    ]);
    expect(gruposDeZona(z)).toEqual([{ ordenId: uuid(777), texto: 'Mesa 4 · Grupo con 5, 6' }]);
  });

  it('la lista recorre la zona por filas y columnas', () => {
    const z = zona(uuid(1), 'Salón', [
      mesa(3, '3', { columna: 1, fila: 2 }),
      mesa(2, '2', { columna: 2, fila: 1 }),
      mesa(1, '1', { columna: 1, fila: 1 }),
    ]);
    expect(mesasEnOrdenDeLectura(z).map((m) => m.nombre)).toEqual(['1', '2', '3']);
  });

  it('la segunda línea de una fila de la lista resume la cuenta', () => {
    expect(ayudaDeFila(mesa(1, '1', { capacidad: 6 }), ahora)).toBe('Capacidad 6');
    expect(
      ayudaDeFila(mesa(1, '1', { orden: { comensales: 1, minutos: 5, mozo: 'Ana Ríos' } }), ahora),
    ).toBe('1 persona · 5 min · Ana Ríos');
    const unidas = [
      { id: uuid(101), nombre: '1' },
      { id: uuid(102), nombre: '2' },
    ];
    expect(ayudaDeFila(mesa(1, '1', { orden: { mesas: unidas } }), ahora)).toBe(
      '3 personas · 25 min · Ana Ríos · Grupo con 2',
    );
  });

  it('el total sale tal como lo calculó la API, en soles', () => {
    expect(totalDeMesa(mesa(1, '1'))).toBeNull();
    expect(totalDeMesa(mesa(1, '1', { orden: { total: '1284.5' } }))).toBe('S/ 1,284.50');
  });
});

describe('medidas del mapa', () => {
  it('las baldosas llenan el ancho entre 88 y 104 px', () => {
    // 360 px de celular menos 32 de márgenes: 328 px para el mapa.
    // (328 - 18 de marco - 8 de juntas) / 3 columnas = 100 px
    expect(ladoDeCelda(328, 3)).toBe(100);
    expect(ladoDeCelda(328, 2)).toBe(CELDA_MAXIMA);
    expect(ladoDeCelda(328, 4)).toBe(CELDA_MINIMA);
    expect(ladoDeCelda(0, 4)).toBe(CELDA_MINIMA);
  });

  it('el mapa cabe si todas las columnas llegan a 88 px; si no, se ofrece la lista', () => {
    expect(cabeElMapa(328, 3)).toBe(true);
    expect(cabeElMapa(328, 4)).toBe(false);
    // Una tableta de 768 px con el riel de 96 y márgenes: unos 600 px.
    expect(cabeElMapa(600, 6)).toBe(true);
    expect(cabeElMapa(600, 7)).toBe(false);
    // Sin medida todavía, el mapa es lo normal.
    expect(cabeElMapa(0, 12)).toBe(true);
  });
});

describe('personas que pueden ser el mozo responsable (decisión 8)', () => {
  const S1 = '33333333-3333-4333-8333-333333333333';
  const S2 = '44444444-4444-4444-8444-444444444444';
  const usuario = (
    n: number,
    nombre: string,
    accesos: UsuarioRespuesta['accesos'],
    extra: Partial<UsuarioRespuesta> = {},
  ): UsuarioRespuesta => ({
    id: uuid(n),
    nombre,
    nombreUsuario: nombre.toLowerCase(),
    esAdministrador: false,
    accesos,
    activo: true,
    horario: null,
    largoPin: 4,
    contrasenaTemporal: false,
    equiposRecordados: 0,
    creadoEn: AHORA,
    actualizadoEn: AHORA,
    ...extra,
  });

  it('incluye Mozo, Cajero, Supervisor y Administrador de la sucursal; no Cocina/Barra ni otras sucursales ni inactivos', () => {
    const lista = [
      usuario(1, 'Zoila', [{ sucursalId: S1, rol: 'MOZO' }]),
      usuario(2, 'Carla', [{ sucursalId: S1, rol: 'CAJERO' }]),
      usuario(3, 'Pedro', [{ sucursalId: S1, rol: 'COCINA_BARRA' }]),
      usuario(4, 'Sofía', [{ sucursalId: S1, rol: 'SUPERVISOR' }]),
      usuario(5, 'Luis', [{ sucursalId: S2, rol: 'MOZO' }]),
      usuario(6, 'Inés', [{ sucursalId: S1, rol: 'MOZO' }], { activo: false }),
      usuario(7, 'Dueño', [], { esAdministrador: true }),
    ];
    expect(personasQueAtienden(lista, S1).map((p) => [p.nombre, p.rol])).toEqual([
      ['Carla', 'Cajero'],
      ['Dueño', 'Administrador'],
      ['Sofía', 'Supervisor'],
      ['Zoila', 'Mozo'],
    ]);
  });

  it('un usuario con rol distinto en cada sucursal cuenta según la sucursal pedida', () => {
    const mixto = usuario(8, 'Mixto', [
      { sucursalId: S1, rol: 'COCINA_BARRA' },
      { sucursalId: S2, rol: 'MOZO' },
    ]);
    expect(personasQueAtienden([mixto], S1)).toEqual([]);
    expect(personasQueAtienden([mixto], S2)).toHaveLength(1);
  });
});

describe('el mapa del salón de ejemplo', () => {
  it('se arma con el esquema del contrato', () => {
    const z = salon([zona(uuid(1), 'Salón', [mesa(1, '1')])]);
    expect(z.zonas[0]?.mesas).toHaveLength(1);
  });
});
