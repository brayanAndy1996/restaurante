import type {
  EstacionRespuesta,
  FamiliaRespuesta,
  GrupoRespuesta,
  ProductoRespuesta,
  ProductoResumen,
  SesionRespuesta,
} from '@restaurante/contratos';
import { permisosDeRol } from '@restaurante/dominio';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardarTokenDeSesion } from '../src/lib/almacen';
import { espera } from '../src/lib/api';
import { ID, json, renderApp, servidor, sesionDe } from './ayudas';

const TOKEN =
  'se.11111111-1111-4111-8111-111111111111.22222222-2222-4222-8222-222222222222.secreto';

const FAM = 'f1000000-0000-4000-8000-000000000001';
const EST_COCINA = 'e1000000-0000-4000-8000-000000000001';
const P_HAMB = 'a1000000-0000-4000-8000-0000000000a1';
const P_PAPAS = 'a2000000-0000-4000-8000-0000000000a2';
const P_LOMO = 'a3000000-0000-4000-8000-0000000000a3';
const P_COMBO = 'a4000000-0000-4000-8000-0000000000a4';
const P_MENU = 'a5000000-0000-4000-8000-0000000000a5';
const P_INACTIVO = 'a6000000-0000-4000-8000-0000000000a6';
const G_BEBIDA = 'b1000000-0000-4000-8000-000000000001';
const G_ACOMP = 'b2000000-0000-4000-8000-000000000002';
const INSTANTE = '2026-10-29T10:00:00.000Z';

const administrador = (): SesionRespuesta =>
  sesionDe({ rol: 'ADMINISTRADOR', permisos: permisosDeRol('ADMINISTRADOR') });

const resumen = (
  id: string,
  nombre: string,
  extra: Partial<ProductoResumen> = {},
): ProductoResumen => ({
  id,
  tipo: 'SIMPLE',
  nombre,
  familiaId: FAM,
  precio: '15.00',
  seVendeSolo: true,
  estacionId: EST_COCINA,
  tipoControlStock: 'PORCIONES',
  fotoUrl: null,
  activo: true,
  orden: 1,
  ...extra,
});
const completo = (
  base: ProductoResumen,
  extra: Partial<ProductoRespuesta> = {},
): ProductoRespuesta => ({
  ...base,
  descripcion: null,
  afectacionIgv: 'GRAVADO',
  aplicaIcbper: false,
  grupos: [],
  componentes: [],
  usadoEn: { combos: [], modificadores: [] },
  creadoEn: INSTANTE,
  actualizadoEn: INSTANTE,
  ...extra,
});

const familias: FamiliaRespuesta[] = [
  {
    id: FAM,
    nombre: 'Fondos',
    orden: 1,
    activa: true,
    productos: 6,
    creadoEn: INSTANTE,
    actualizadoEn: INSTANTE,
  },
];
const estaciones: EstacionRespuesta[] = [
  {
    id: EST_COCINA,
    nombre: 'Cocina',
    activa: true,
    productosActivos: 3,
    creadoEn: INSTANTE,
    actualizadoEn: INSTANTE,
  },
];

const HAMBURGUESA = resumen(P_HAMB, 'Hamburguesa clásica');
const PAPAS = resumen(P_PAPAS, 'Papas del combo', {
  seVendeSolo: false,
  precio: null,
  estacionId: null,
});
const LOMO = resumen(P_LOMO, 'Lomo saltado', { precio: '28.00' });
const COMBO = resumen(P_COMBO, 'Combo hamburguesa', {
  tipo: 'COMBO',
  precio: '22.90',
  estacionId: null,
});
const MENU = resumen(P_MENU, 'Menú criollo', {
  tipo: 'MENU_DEL_DIA',
  precio: '12.00',
  estacionId: null,
});
const INACTIVO = resumen(P_INACTIVO, 'Chaufa', { activo: false });
const PRODUCTOS = [HAMBURGUESA, PAPAS, LOMO, COMBO, MENU, INACTIVO];

const grupo = (
  id: string,
  nombre: string,
  opciones: [string, string][],
  extra: Partial<GrupoRespuesta> = {},
): GrupoRespuesta => ({
  id,
  nombre,
  seleccion: 'UNICA',
  minimo: 1,
  maximo: 1,
  obligatorio: true,
  activo: true,
  modificadores: opciones.map(([n, extraPrecio], i) => ({
    id: `c${i}000000-0000-4000-8000-${id.slice(1, 3)}00000000${i}0`.slice(0, 36),
    nombre: n,
    precioExtra: extraPrecio,
    producto: null,
    orden: i + 1,
  })),
  productos: [],
  ...extra,
});
const BEBIDA = grupo(G_BEBIDA, 'Bebida', [
  ['Chicha', '0.00'],
  ['Inca Kola', '0.00'],
  ['Cerveza', '4.50'],
]);
const ACOMPANAMIENTO = grupo(G_ACOMP, 'Acompañamiento', [
  ['Papas', '0.00'],
  ['Ensalada', '1.00'],
]);

function carta(sesion: SesionRespuesta, extra: Parameters<typeof servidor>[0] = {}) {
  return servidor({
    'GET /sesion': () => json(200, sesion),
    'GET /carta/familias': () => json(200, familias),
    'GET /carta/estaciones': () => json(200, estaciones),
    'GET /carta/productos': () => json(200, PRODUCTOS),
    'GET /carta/grupos-modificadores': () => json(200, [BEBIDA, ACOMPANAMIENTO]),
    [`GET /carta/productos/${P_COMBO}/sucursales`]: () => json(200, []),
    [`GET /carta/productos/${P_LOMO}/sucursales`]: () => json(200, []),
    [`GET /carta/productos/${P_MENU}/sucursales`]: () => json(200, []),
    ...extra,
  });
}

beforeEach(() => {
  vi.spyOn(espera, 'dormir').mockResolvedValue();
  guardarTokenDeSesion(TOKEN);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function elegirTipo(nombre: 'Simple' | 'Combo' | 'Menú del día') {
  await userEvent.click(screen.getByRole('button', { name: nombre }));
}

// Pega el texto de una vez en vez de pulsar tecla por tecla: el formulario entero se vuelve a pintar
// con cada pulsación, y lo que la prueba comprueba es el valor que llega al envío, no el tecleo.
async function escribir(u: ReturnType<typeof userEvent.setup>, etiqueta: string, texto: string) {
  await u.click(screen.getByLabelText(etiqueta));
  await u.paste(texto);
}

describe('formulario de combo: alta', () => {
  it('el selector ofrece los tres tipos; al elegir Combo se van la estación y "Se vende solo" y aparecen los componentes', async () => {
    carta(administrador());
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    expect(screen.getByRole('button', { name: 'Simple' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Estación')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Componentes' })).not.toBeInTheDocument();

    await elegirTipo('Combo');
    expect(screen.getByRole('button', { name: 'Combo' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('Estación')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Se vende solo' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Componentes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Grupos de opciones' })).toBeInTheDocument();
    expect(screen.getByLabelText('Precio base con IGV')).toBeInTheDocument();
    expect(screen.getByText(/no tiene estación propia/)).toBeInTheDocument();
  });

  it('crea un combo con componentes, cantidad y grupos, y la vista previa calcula el precio con las opciones', async () => {
    const creado = completo(COMBO, {
      componentes: [{ productoId: P_HAMB, nombre: 'Hamburguesa clásica', cantidad: 2 }],
      grupos: [
        { id: G_BEBIDA, nombre: 'Bebida' },
        { id: G_ACOMP, nombre: 'Acompañamiento' },
      ],
    });
    const s = carta(administrador(), {
      'POST /carta/productos': () => json(201, creado),
      [`GET /carta/productos/${P_COMBO}`]: () => json(200, creado),
    });
    // Sin la espera de un tick entre cada pulsación: el formulario se vuelve a pintar con cada una
    // y, con la máquina cargada, esos ticks son los que llevaban la prueba al límite de tiempo.
    const u = userEvent.setup({ delay: null });
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await u.click(screen.getByRole('button', { name: 'Combo' }));
    await escribir(u, 'Nombre', 'Combo hamburguesa');
    await u.selectOptions(screen.getByLabelText('Familia'), FAM);
    await escribir(u, 'Precio base con IGV', '22.9');
    await u.click(screen.getByRole('radio', { name: /Por unidades/ }));

    // Componentes: solo productos simples y activos, no el combo, ni el menú, ni el inactivo.
    await u.click(screen.getByRole('button', { name: 'Agregar un componente' }));
    const ofrecidos = await screen.findByRole('list', { name: 'Productos que puedes agregar' });
    expect(
      within(ofrecidos)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining('Hamburguesa clásica'),
      expect.stringContaining('Papas del combo'),
      expect.stringContaining('Lomo saltado'),
    ]);
    expect(within(ofrecidos).getByText(/No se vende solo/)).toBeInTheDocument();
    await u.click(within(ofrecidos).getByRole('button', { name: 'Agregar Hamburguesa clásica' }));
    const componentes = screen.getByRole('list', { name: 'Componentes de este producto' });
    expect(within(componentes).getByText('Hamburguesa clásica')).toBeInTheDocument();
    await u.click(
      screen.getByRole('button', { name: 'Agregar una unidad de Hamburguesa clásica' }),
    );
    expect(within(componentes).getByRole('status')).toHaveTextContent('× 2');

    // Grupos de opciones, reutilizando los de la carta.
    await u.click(screen.getByRole('button', { name: 'Agregar un grupo' }));
    await u.click(await screen.findByRole('button', { name: 'Agregar Bebida' }));
    await u.click(screen.getByRole('button', { name: 'Agregar un grupo' }));
    await u.click(await screen.findByRole('button', { name: 'Agregar Acompañamiento' }));

    // Vista previa: por defecto las primeras opciones, sin recargo.
    const vista = screen
      .getByRole('heading', { name: 'Vista previa del precio' })
      .closest('section')!;
    const total = within(vista).getByText('Precio con estas opciones').closest('[role="status"]')!;
    expect(total).toHaveTextContent('S/ 22.90');
    await u.click(within(vista).getByRole('radio', { name: /Cerveza/ }));
    expect(total).toHaveTextContent('S/ 27.40');
    await u.click(within(vista).getByRole('radio', { name: /Ensalada/ }));
    expect(total).toHaveTextContent('S/ 28.40');
    await u.click(within(vista).getByRole('radio', { name: /Inca Kola/ }));
    expect(total).toHaveTextContent('S/ 23.90');

    await u.click(screen.getByRole('button', { name: 'Crear producto' }));
    expect(await screen.findByText('Producto creado')).toBeInTheDocument();
    const llamada = s.de('POST', '/carta/productos')[0];
    expect(llamada?.cuerpo).toEqual({
      tipo: 'COMBO',
      nombre: 'Combo hamburguesa',
      familiaId: FAM,
      seVendeSolo: true,
      precio: '22.90',
      afectacionIgv: 'GRAVADO',
      aplicaIcbper: false,
      tipoControlStock: 'UNIDADES',
      gruposModificadores: [G_BEBIDA, G_ACOMP],
      componentes: [{ productoId: P_HAMB, cantidad: 2 }],
    });
    expect(llamada?.cabeceras.get('Idempotency-Key')).toBeTruthy();
  });

  it('la vista previa avisa si falta el precio o si la selección no cumple el grupo', async () => {
    carta(administrador());
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await elegirTipo('Combo');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar un grupo' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar Bebida' }));
    const vista = screen
      .getByRole('heading', { name: 'Vista previa del precio' })
      .closest('section')!;
    expect(within(vista).getByText(/Escribe el precio del producto/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Precio base con IGV'), '10');
    expect(within(vista).getByText('S/ 10.00')).toBeInTheDocument();
  });

  it('un grupo de varias opciones se prueba con casillas y avisa si se pasa del máximo', async () => {
    const extras = grupo(
      'b3000000-0000-4000-8000-000000000003',
      'Extras',
      [
        ['Huevo', '2.50'],
        ['Plátano', '3.00'],
        ['Queso', '2.00'],
      ],
      { seleccion: 'MULTIPLE', minimo: 0, maximo: 2, obligatorio: false },
    );
    carta(administrador(), { 'GET /carta/grupos-modificadores': () => json(200, [extras]) });
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await elegirTipo('Combo');
    await userEvent.type(screen.getByLabelText('Precio base con IGV'), '28');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar un grupo' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar Extras' }));
    const vista = screen
      .getByRole('heading', { name: 'Vista previa del precio' })
      .closest('section')!;
    const total = within(vista).getByText('Precio con estas opciones').closest('[role="status"]')!;
    expect(total).toHaveTextContent('S/ 28.00');
    await userEvent.click(within(vista).getByRole('checkbox', { name: /Huevo/ }));
    await userEvent.click(within(vista).getByRole('checkbox', { name: /Plátano/ }));
    expect(total).toHaveTextContent('S/ 33.50');
    await userEvent.click(within(vista).getByRole('checkbox', { name: /Queso/ }));
    expect(total).toHaveTextContent('Elige como máximo 2 en «Extras»');
  });

  it('no deja crear un combo vacío ni un menú sin tiempos, y no envía nada', async () => {
    const s = carta(administrador());
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await elegirTipo('Combo');
    await userEvent.click(screen.getByRole('button', { name: 'Crear producto' }));
    expect(
      screen.getByText('Agrega al menos un componente o un grupo de opciones'),
    ).toBeInTheDocument();
    expect(screen.getByText('Escribe el precio con IGV')).toBeInTheDocument();
    expect(screen.queryByText(/Elige la estación/)).not.toBeInTheDocument();
    await elegirTipo('Menú del día');
    await userEvent.click(screen.getByRole('button', { name: 'Crear producto' }));
    expect(
      screen.getByText(/Agrega al menos un grupo: cada grupo es un tiempo/),
    ).toBeInTheDocument();
    expect(s.de('POST', '/carta/productos')).toHaveLength(0);
  });

  it('un menú del día avisa desde el alta que nace sin armar y usa "tiempos" para sus grupos', async () => {
    carta(administrador());
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await elegirTipo('Menú del día');
    expect(screen.getByText('Un menú del día nace sin armar')).toBeInTheDocument();
    expect(
      screen.getByText(/No se podrá vender hasta armar sus opciones del día/),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tiempos del menú' })).toBeInTheDocument();
  });

  it('un componente que ya no existe se dice en su sección, sin perder lo escrito', async () => {
    carta(administrador(), {
      'POST /carta/productos': () =>
        json(422, {
          codigo: 'REFERENCIA_INVALIDA',
          mensaje: 'x',
          campos: [{ campo: 'componentes.0.productoId', mensaje: 'x' }],
        }),
    });
    renderApp('/carta/productos/nuevo');
    await screen.findByRole('heading', { name: 'Datos' });
    await elegirTipo('Combo');
    await userEvent.type(screen.getByLabelText('Nombre'), 'Combo hamburguesa');
    await userEvent.selectOptions(screen.getByLabelText('Familia'), FAM);
    await userEvent.type(screen.getByLabelText('Precio base con IGV'), '22.9');
    await userEvent.click(screen.getByRole('radio', { name: /Por unidades/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Agregar un componente' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Agregar Hamburguesa clásica' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Crear producto' }));
    expect(await screen.findByText('Revisa los componentes')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Combo hamburguesa');
    expect(screen.getByRole('list', { name: 'Componentes de este producto' })).toBeInTheDocument();
  });
});

describe('formulario de combo: edición', () => {
  const rutaCombo = `/carta/productos/${P_COMBO}`;
  const combo = completo(COMBO, {
    componentes: [{ productoId: P_HAMB, nombre: 'Hamburguesa clásica', cantidad: 1 }],
    grupos: [{ id: G_BEBIDA, nombre: 'Bebida' }],
  });

  it('un combo guardado se edita con sus componentes, su cantidad y la vista previa', async () => {
    const s = carta(administrador(), {
      [`GET ${rutaCombo}`]: () => json(200, combo),
      [`PATCH ${rutaCombo}`]: () =>
        json(200, {
          ...combo,
          componentes: [{ productoId: P_HAMB, nombre: 'Hamburguesa clásica', cantidad: 3 }],
        }),
    });
    renderApp(rutaCombo);
    expect(await screen.findByLabelText('Precio base con IGV')).toHaveValue('22.90');
    expect(screen.getByRole('button', { name: 'Combo' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('Estación')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    const componentes = await screen.findByRole('list', { name: 'Componentes de este producto' });
    expect(within(componentes).getByRole('status')).toHaveTextContent('× 1');
    const mas = screen.getByRole('button', { name: 'Agregar una unidad de Hamburguesa clásica' });
    await userEvent.click(mas);
    await userEvent.click(mas);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    expect(s.de('PATCH', rutaCombo)[0]?.cuerpo).toEqual({
      componentes: [{ productoId: P_HAMB, cantidad: 3 }],
    });
    // Sin cambio de tipo: nada que confirmar.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('quitar un componente lo saca de la lista y se guarda con el producto', async () => {
    const s = carta(administrador(), {
      [`GET ${rutaCombo}`]: () => json(200, combo),
      [`PATCH ${rutaCombo}`]: () => json(200, { ...combo, componentes: [] }),
    });
    renderApp(rutaCombo);
    await screen.findByRole('list', { name: 'Componentes de este producto' });
    await userEvent.click(screen.getByRole('button', { name: 'Quitar Hamburguesa clásica' }));
    expect(
      screen.queryByRole('list', { name: 'Componentes de este producto' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/«Hamburguesa clásica» quitado de este combo/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Cambios guardados');
    expect(s.de('PATCH', rutaCombo)[0]?.cuerpo).toEqual({ componentes: [] });
  });

  it('un componente desactivado se marca con texto', async () => {
    const conInactivo = completo(COMBO, {
      componentes: [{ productoId: P_INACTIVO, nombre: 'Chaufa', cantidad: 1 }],
    });
    carta(administrador(), { [`GET ${rutaCombo}`]: () => json(200, conInactivo) });
    renderApp(rutaCombo);
    const lista = await screen.findByRole('list', { name: 'Componentes de este producto' });
    await waitFor(() => expect(within(lista).getByText('Inactivo')).toBeInTheDocument());
  });

  it('un menú del día guardado enlaza con "Armar el menú del día" si la persona puede armarlo', async () => {
    const menu = completo(MENU, { grupos: [{ id: G_BEBIDA, nombre: 'Bebida' }] });
    carta(administrador(), { [`GET /carta/productos/${P_MENU}`]: () => json(200, menu) });
    renderApp(`/carta/productos/${P_MENU}`);
    const enlace = await screen.findByRole('link', { name: 'Armar el menú del día' });
    expect(enlace).toHaveAttribute('href', '/disponibilidad?ver=menu');
  });
});

describe('cambio de tipo al editar', () => {
  const rutaLomo = `/carta/productos/${P_LOMO}`;
  const lomo = completo(LOMO);
  const comoCombo = completo(LOMO, {
    tipo: 'COMBO',
    estacionId: null,
    componentes: [{ productoId: P_PAPAS, nombre: 'Papas del combo', cantidad: 1 }],
  });

  async function simpleACombo() {
    await screen.findByLabelText('Nombre');
    await elegirTipo('Combo');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar un componente' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar Papas del combo' }));
  }

  it('al elegir otro tipo muestra los campos del tipo nuevo y avisa qué se quitará al guardar', async () => {
    carta(administrador(), { [`GET ${rutaLomo}`]: () => json(200, lomo) });
    renderApp(rutaLomo);
    await screen.findByLabelText('Nombre');
    await elegirTipo('Combo');
    expect(screen.queryByLabelText('Estación')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Componentes' })).toBeInTheDocument();
    const aviso = screen.getByText('Al guardar, pasará a ser combo').closest('[role="status"]')!;
    expect(aviso).toHaveTextContent('Se quitará la estación Cocina');
    // Volver al tipo guardado quita el aviso y no deja nada que guardar.
    await elegirTipo('Simple');
    expect(screen.queryByText('Al guardar, pasará a ser combo')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Estación')).toHaveValue(EST_COCINA);
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('ante CONFIRMACION_REQUERIDA abre la hoja con lo que se quita y reenvía con confirmarPerdida', async () => {
    let intentos = 0;
    const s = carta(administrador(), {
      [`GET ${rutaLomo}`]: () => json(200, lomo),
      [`PATCH ${rutaLomo}`]: ({ cuerpo }) => {
        intentos += 1;
        if (!(cuerpo as { confirmarPerdida?: boolean }).confirmarPerdida) {
          return json(409, {
            codigo: 'CONFIRMACION_REQUERIDA',
            mensaje: 'x',
            seQuita: {
              estacion: { id: EST_COCINA, nombre: 'Cocina' },
              componentes: [],
              opcionesDelDia: [],
            },
          });
        }
        return json(200, comoCombo);
      },
    });
    renderApp(rutaLomo);
    await simpleACombo();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    const hoja = await screen.findByRole('dialog', { name: '¿Cambiar a combo?' });
    expect(within(hoja).getByText('Se quitará la estación Cocina.')).toBeInTheDocument();
    expect(within(hoja).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    expect(s.de('PATCH', rutaLomo)[0]?.cuerpo).toEqual({
      tipo: 'COMBO',
      componentes: [{ productoId: P_PAPAS, cantidad: 1 }],
    });

    await userEvent.click(within(hoja).getByRole('button', { name: 'Cambiar a combo' }));
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    expect(screen.getByText(/Ahora es combo/)).toBeInTheDocument();
    expect(intentos).toBe(2);
    expect(s.de('PATCH', rutaLomo)[1]?.cuerpo).toEqual({
      tipo: 'COMBO',
      componentes: [{ productoId: P_PAPAS, cantidad: 1 }],
      confirmarPerdida: true,
    });
    expect(screen.queryByRole('dialog', { name: '¿Cambiar a combo?' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Combo' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('"Cancelar" cierra la hoja sin reenviar y conserva lo escrito', async () => {
    const s = carta(administrador(), {
      [`GET ${rutaLomo}`]: () => json(200, lomo),
      [`PATCH ${rutaLomo}`]: () =>
        json(409, {
          codigo: 'CONFIRMACION_REQUERIDA',
          mensaje: 'x',
          seQuita: {
            estacion: { id: EST_COCINA, nombre: 'Cocina' },
            componentes: [],
            opcionesDelDia: [],
          },
        }),
    });
    renderApp(rutaLomo);
    await simpleACombo();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    const hoja = await screen.findByRole('dialog', { name: '¿Cambiar a combo?' });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(s.de('PATCH', rutaLomo)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Combo' })).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(screen.getByRole('list', { name: 'Componentes de este producto' })).getByText(
        'Papas del combo',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
  });

  it('de combo a simple pide la estación (sin dejar "Ninguna" por omisión) y lista los componentes que se quitan', async () => {
    const combo = completo(COMBO, {
      componentes: [
        { productoId: P_HAMB, nombre: 'Hamburguesa clásica', cantidad: 1 },
        { productoId: P_PAPAS, nombre: 'Papas del combo', cantidad: 2 },
      ],
      grupos: [{ id: G_BEBIDA, nombre: 'Bebida' }],
    });
    const rutaCombo = `/carta/productos/${P_COMBO}`;
    const s = carta(administrador(), {
      [`GET ${rutaCombo}`]: () => json(200, combo),
      [`PATCH ${rutaCombo}`]: ({ cuerpo }) =>
        (cuerpo as { confirmarPerdida?: boolean }).confirmarPerdida
          ? json(200, { ...combo, tipo: 'SIMPLE', estacionId: EST_COCINA, componentes: [] })
          : json(409, {
              codigo: 'CONFIRMACION_REQUERIDA',
              mensaje: 'x',
              seQuita: {
                estacion: null,
                componentes: [
                  { productoId: P_HAMB, nombre: 'Hamburguesa clásica', cantidad: 1 },
                  { productoId: P_PAPAS, nombre: 'Papas del combo', cantidad: 2 },
                ],
                opcionesDelDia: [],
              },
            }),
    });
    renderApp(rutaCombo);
    await screen.findByLabelText('Nombre');
    await elegirTipo('Simple');
    const aviso = screen.getByText('Al guardar, pasará a ser simple').closest('[role="status"]')!;
    expect(aviso).toHaveTextContent('Se quitarán sus 2 componentes');
    expect(aviso).toHaveTextContent('Elige la estación donde se prepara');
    expect(screen.getByLabelText('Estación')).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText(/Elige la estación, o "Ninguna"/)).toBeInTheDocument();
    expect(s.de('PATCH', rutaCombo)).toHaveLength(0);

    await userEvent.selectOptions(screen.getByLabelText('Estación'), EST_COCINA);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    const hoja = await screen.findByRole('dialog', { name: '¿Cambiar a simple?' });
    expect(
      within(hoja).getByText(
        'Se quitarán los componentes: Hamburguesa clásica × 1, Papas del combo × 2.',
      ),
    ).toBeInTheDocument();
    expect(s.de('PATCH', rutaCombo)[0]?.cuerpo).toEqual({ tipo: 'SIMPLE', estacionId: EST_COCINA });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cambiar a simple' }));
    expect(await screen.findByText(/Ahora es simple/)).toBeInTheDocument();
    expect(s.de('PATCH', rutaCombo)[1]?.cuerpo).toEqual({
      tipo: 'SIMPLE',
      estacionId: EST_COCINA,
      confirmarPerdida: true,
    });
  });

  it('de menú del día a combo lista las opciones del día que se borran, por sucursal y día', async () => {
    const menu = completo(MENU, { grupos: [{ id: G_BEBIDA, nombre: 'Bebida' }] });
    const rutaMenu = `/carta/productos/${P_MENU}`;
    carta(administrador(), {
      [`GET ${rutaMenu}`]: () => json(200, menu),
      [`PATCH ${rutaMenu}`]: () =>
        json(409, {
          codigo: 'CONFIRMACION_REQUERIDA',
          mensaje: 'x',
          seQuita: {
            estacion: null,
            componentes: [],
            opcionesDelDia: [
              {
                sucursalId: ID.sucursalA,
                sucursalNombre: 'Miraflores',
                dia: '2026-10-29',
                opciones: 4,
              },
              { sucursalId: ID.sucursalB, sucursalNombre: 'Surco', dia: '2026-10-30', opciones: 3 },
            ],
          },
        }),
    });
    renderApp(rutaMenu);
    await screen.findByLabelText('Nombre');
    await elegirTipo('Combo');
    expect(
      screen.getByText(/Se borrarán las opciones del día ya armadas en todas las sucursales/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    const hoja = await screen.findByRole('dialog', { name: '¿Cambiar a combo?' });
    expect(
      within(hoja).getByText(
        'Se borrarán las opciones del menú del jueves 29 de octubre en Miraflores (4).',
      ),
    ).toBeInTheDocument();
    expect(
      within(hoja).getByText(
        'Se borrarán las opciones del menú del viernes 30 de octubre en Surco (3).',
      ),
    ).toBeInTheDocument();
  });

  it('al pasar a menú del día avisa que no se podrá vender hasta armarlo, antes y después de guardar', async () => {
    const comoMenu = completo(LOMO, {
      tipo: 'MENU_DEL_DIA',
      estacionId: null,
      grupos: [{ id: G_BEBIDA, nombre: 'Bebida' }],
    });
    carta(administrador(), {
      [`GET ${rutaLomo}`]: () => json(200, lomo),
      [`PATCH ${rutaLomo}`]: ({ cuerpo }) =>
        (cuerpo as { confirmarPerdida?: boolean }).confirmarPerdida
          ? json(200, comoMenu)
          : json(409, {
              codigo: 'CONFIRMACION_REQUERIDA',
              mensaje: 'x',
              seQuita: {
                estacion: { id: EST_COCINA, nombre: 'Cocina' },
                componentes: [],
                opcionesDelDia: [],
              },
            }),
    });
    renderApp(rutaLomo);
    await screen.findByLabelText('Nombre');
    await elegirTipo('Menú del día');
    expect(
      screen.getByText(/No se podrá vender hasta armar sus opciones del día en cada sucursal/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Se quitará la estación Cocina/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Agregar un grupo' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar Bebida' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    const hoja = await screen.findByRole('dialog', { name: '¿Cambiar a menú del día?' });
    await userEvent.click(within(hoja).getByRole('button', { name: 'Cambiar a menú del día' }));
    const guardado = (await screen.findByText('Cambios guardados')).closest('[role="status"]')!;
    expect(guardado).toHaveTextContent('Ahora es menú del día');
    expect(guardado).toHaveTextContent('No se podrá vender hasta armar sus opciones del día');
  });

  it('EN_USO explica dónde se usa con enlaces, no ofrece continuar y deja volver al tipo anterior', async () => {
    const s = carta(administrador(), {
      [`GET ${rutaLomo}`]: () => json(200, lomo),
      [`PATCH ${rutaLomo}`]: () =>
        json(409, {
          codigo: 'EN_USO',
          mensaje: 'x',
          usadoEn: {
            combos: [{ id: P_COMBO, nombre: 'Combo hamburguesa' }],
            modificadores: [
              {
                id: 'c9000000-0000-4000-8000-000000000009',
                nombre: 'Inca Kola',
                grupoId: G_BEBIDA,
                grupoNombre: 'Bebida del combo',
              },
            ],
          },
        }),
    });
    renderApp(rutaLomo);
    await screen.findByLabelText('Nombre');
    await elegirTipo('Combo');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar un componente' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar Papas del combo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    const aviso = (await screen.findByText('No se puede cambiar a combo')).closest(
      '[role="alert"]',
    ) as HTMLElement;
    expect(aviso).toHaveTextContent('Se usa en:');
    expect(within(aviso).getByRole('link', { name: 'Combo hamburguesa' })).toHaveAttribute(
      'href',
      `/carta/productos/${P_COMBO}`,
    );
    expect(within(aviso).getByRole('link', { name: 'Bebida del combo' })).toHaveAttribute(
      'href',
      `/carta/grupos/${G_BEBIDA}`,
    );
    expect(aviso).toHaveTextContent('Inca Kola');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(aviso).queryByRole('button', { name: /Cambiar a/ })).not.toBeInTheDocument();
    expect(s.de('PATCH', rutaLomo)).toHaveLength(1);

    await userEvent.click(within(aviso).getByRole('button', { name: 'Dejarlo como simple' }));
    expect(screen.queryByText('No se puede cambiar a combo')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Estación')).toHaveValue(EST_COCINA);
  });

  it('dejar de venderse solo con precio propio en una sucursal dice qué hacer y no lo confunde con un nombre repetido', async () => {
    carta(administrador(), {
      [`GET ${rutaLomo}`]: () => json(200, lomo),
      [`PATCH ${rutaLomo}`]: () =>
        json(409, {
          codigo: 'CONFLICTO',
          mensaje: 'Tiene precio propio en Surco.',
          campos: [{ campo: 'seVendeSolo', mensaje: 'x' }],
        }),
    });
    renderApp(rutaLomo);
    await screen.findByLabelText('Nombre');
    await userEvent.click(screen.getByRole('switch', { name: 'Se vende solo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    const aviso = (await screen.findByText('No pudimos guardar')).closest('[role="alert"]')!;
    expect(aviso).toHaveTextContent('Tiene precio propio en Surco.');
    expect(aviso).toHaveTextContent('Precio por sucursal');
    expect(screen.queryByText(/Ya tienes un producto con ese nombre/)).not.toBeInTheDocument();
  });
});

describe('Pendiente de envío (criterio 78)', () => {
  const rutaLomo = `/carta/productos/${P_LOMO}`;
  const lomo = completo(LOMO);

  it('sin conexión al guardar un producto lo dice, conserva lo escrito y lo envía solo con la misma clave al volver', async () => {
    let sinRed = true;
    let llamadasDeEspera = 0;
    let liberar!: () => void;
    const compuerta = new Promise<void>((resolver) => (liberar = resolver));
    // Las 6 esperas cortas de api.ts pasan solas; la primera espera larga del envío espera a la prueba.
    vi.spyOn(espera, 'dormir').mockImplementation(async () => {
      if (++llamadasDeEspera === 7) await compuerta;
    });
    const s = carta(administrador(), {
      [`GET ${rutaLomo}`]: () => json(200, lomo),
      [`PATCH ${rutaLomo}`]: () => {
        if (sinRed) throw new TypeError('Failed to fetch');
        return json(200, { ...lomo, precio: '31.00' });
      },
    });
    renderApp(rutaLomo);
    const precio = await screen.findByLabelText('Precio con IGV');
    await userEvent.clear(precio);
    await userEvent.type(precio, '31');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    const aviso = (await screen.findAllByText('Pendiente de envío'))[0]!.closest(
      '[role="status"]',
    )!;
    expect(aviso).toHaveTextContent('Tus cambios se enviarán solos');
    expect(screen.getByLabelText('Precio con IGV')).toHaveValue('31.00');
    expect(screen.getByText('Sin conexión')).toBeInTheDocument();

    sinRed = false;
    liberar();
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    expect(screen.queryByText('Pendiente de envío')).not.toBeInTheDocument();
    const claves = new Set(s.de('PATCH', rutaLomo).map((l) => l.cabeceras.get('Idempotency-Key')));
    expect(claves.size).toBe(1);
    expect([...claves][0]).toBeTruthy();
  });

  it('un error de negocio mientras tanto no se queda "pendiente": se dice y se puede corregir', async () => {
    carta(administrador(), {
      [`GET ${rutaLomo}`]: () => json(200, lomo),
      [`PATCH ${rutaLomo}`]: () => json(403, { codigo: 'PROHIBIDO', mensaje: 'x' }),
    });
    renderApp(rutaLomo);
    const nombre = await screen.findByLabelText('Nombre');
    await userEvent.clear(nombre);
    await userEvent.type(nombre, 'Lomo especial');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(
      await screen.findByText('No tienes permiso para cambiar este producto.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Pendiente de envío')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Lomo especial');
  });
});
