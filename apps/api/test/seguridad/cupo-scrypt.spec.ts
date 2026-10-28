// Pruebas del desarrollador (no protegidas) de I-5: `CupoScrypt` y `capacidadDeScrypt` directamente, con
// temporizadores falsos y un número de núcleos simulado.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorAplicacion } from '../../src/nucleo/errores/error-aplicacion';
import { CupoScrypt, capacidadDeScrypt } from '../../src/modulos/seguridad/cupo-scrypt';

// `capacidadDeScrypt` lee los núcleos con `availableParallelism`: se simulan para probar cualquier equipo.
const maquina = vi.hoisted(() => ({ nucleos: 8 }));
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  availableParallelism: () => maquina.nucleos,
}));

const hilosOriginales = process.env.UV_THREADPOOL_SIZE;
const fijarMaquina = (hilos: string | undefined, nucleos: number) => {
  if (hilos === undefined) delete process.env.UV_THREADPOOL_SIZE;
  else process.env.UV_THREADPOOL_SIZE = hilos;
  maquina.nucleos = nucleos;
};

const turno = () => vi.advanceTimersByTimeAsync(0);

/** Tarea que ocupa un cupo hasta que se llame a `terminar()`. */
function tarea(arranques: string[], id: string) {
  let terminar!: () => void;
  const fn = () =>
    new Promise<string>((resolver) => {
      arranques.push(id);
      terminar = () => resolver(id);
    });
  return { fn, terminar: () => terminar() };
}

const esDemasiadosALaVez = (error: unknown) => {
  expect(error).toBeInstanceOf(ErrorAplicacion);
  expect(error).toMatchObject({ codigo: 'BLOQUEO_TEMPORAL', reintentarEnSegundos: 1 });
  expect((error as ErrorAplicacion).getStatus()).toBe(429);
};

/** Convierte una promesa en una que nunca rechaza, para no dejar rechazos sin atender mientras se avanza el reloj. */
const resultado = <T>(promesa: Promise<T>) =>
  promesa.then(
    (valor) => ({ valor }) as const,
    (error: unknown) => ({ error }) as const,
  );

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  fijarMaquina(hilosOriginales, 8);
});

describe('capacidadDeScrypt', () => {
  // [UV_THREADPOOL_SIZE, núcleos, capacidad]: min(hilos - 1, núcleos - 1), nunca menos de 1.
  it.each([
    [undefined, 8, 3], // 4 hilos por defecto
    [undefined, 4, 3],
    [undefined, 3, 2],
    [undefined, 2, 1], // con 2 núcleos o menos baja a 1
    [undefined, 1, 1],
    ['4', 16, 3],
    ['8', 16, 7],
    ['8', 4, 3], // los núcleos limitan
    ['8', 2, 1],
    ['2', 8, 1],
    ['1', 8, 1], // un solo hilo: nunca 0
    ['128', 200, 127],
    ['no-es-un-número', 8, 3], // se ignora y se usa el valor por defecto de Node (4)
    ['0', 8, 3],
    ['', 8, 3],
  ] as const)('UV_THREADPOOL_SIZE=%s con %s núcleos da %s cupos', (hilos, nucleos, esperada) => {
    fijarMaquina(hilos, nucleos);
    expect(capacidadDeScrypt()).toBe(esperada);
  });

  it('CupoScrypt toma su capacidad al crearse', () => {
    fijarMaquina('6', 8);
    expect(new CupoScrypt().capacidad).toBe(5);
    fijarMaquina('2', 8);
    expect(new CupoScrypt().capacidad).toBe(1);
  });
});

describe('CupoScrypt.conCupo', () => {
  let cupo: CupoScrypt;
  beforeEach(() => {
    fijarMaquina('2', 8); // un solo cupo: las esperas son deterministas
    cupo = new CupoScrypt();
  });

  it('con cupo libre corre fn al instante y devuelve su resultado', async () => {
    await expect(cupo.conCupo('g', async () => 'ok')).resolves.toBe('ok');
  });

  it('se libera cuando fn lanza: el siguiente corre y el error llega a quien lo causó', async () => {
    const arranques: string[] = [];
    const siguiente = tarea(arranques, 'siguiente');
    const falla = resultado(
      cupo.conCupo('g', async () => {
        arranques.push('falla');
        throw new Error('scrypt falló');
      }),
    );
    const ps = cupo.conCupo('g', siguiente.fn);
    await turno();
    expect(await falla).toMatchObject({
      error: expect.objectContaining({ message: 'scrypt falló' }),
    });
    expect(arranques).toEqual(['falla', 'siguiente']);
    siguiente.terminar();
    await expect(ps).resolves.toBe('siguiente');
    // No quedó ningún cupo ocupado.
    await expect(cupo.conCupo('g', async () => 'libre')).resolves.toBe('libre');
  });

  it('hay tantas ejecuciones a la vez como capacidad; la siguiente espera a que se libere un cupo', async () => {
    fijarMaquina('3', 8); // 2 cupos
    cupo = new CupoScrypt();
    expect(cupo.capacidad).toBe(2);
    const arranques: string[] = [];
    const [a, b, c] = ['a', 'b', 'c'].map((id) => tarea(arranques, id)) as [
      ReturnType<typeof tarea>,
      ReturnType<typeof tarea>,
      ReturnType<typeof tarea>,
    ];
    const todas = Promise.all([
      cupo.conCupo('g', a.fn),
      cupo.conCupo('g', b.fn),
      cupo.conCupo('g', c.fn),
    ]);
    await turno();
    expect(arranques).toEqual(['a', 'b']);
    b.terminar();
    await turno();
    expect(arranques).toEqual(['a', 'b', 'c']);
    a.terminar();
    c.terminar();
    await todas;
  });

  it('espera como máximo 2 s: pasado el plazo responde 429 de 1 s sin ejecutar fn', async () => {
    const arranques: string[] = [];
    const dueño = tarea(arranques, 'dueño');
    const pd = cupo.conCupo('g', dueño.fn);
    const impaciente = vi.fn(async () => 'no debe correr');
    const pi = resultado(cupo.conCupo('g', impaciente));
    await vi.advanceTimersByTimeAsync(1_999);
    let resuelto = false;
    void pi.then(() => {
      resuelto = true;
    });
    await turno();
    expect(resuelto).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const r = await pi;
    esDemasiadosALaVez('error' in r ? r.error : undefined);
    expect(impaciente).not.toHaveBeenCalled();
    // El cupo del dueño no se perdió ni se duplicó: al terminar queda libre una sola vez.
    dueño.terminar();
    await pd;
    const arranques2: string[] = [];
    const x = tarea(arranques2, 'x');
    const y = tarea(arranques2, 'y');
    const px = cupo.conCupo('g', x.fn);
    const py = cupo.conCupo('g', y.fn);
    await turno();
    expect(arranques2).toEqual(['x']); // un solo cupo: y espera
    x.terminar();
    await turno();
    y.terminar();
    await Promise.all([px, py]);
  });

  it('quien recibe el cupo antes del plazo cancela su temporizador', async () => {
    const arranques: string[] = [];
    const a = tarea(arranques, 'a');
    const b = tarea(arranques, 'b');
    const pa = cupo.conCupo('g', a.fn);
    const pb = cupo.conCupo('g', b.fn);
    await turno();
    a.terminar();
    await turno();
    b.terminar();
    await Promise.all([pa, pb]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('la cola de un grupo admite 64 esperas: la 65.ª recibe 429 al instante, sin esperar el plazo', async () => {
    const arranques: string[] = [];
    const dueño = tarea(arranques, 'dueño');
    const pd = cupo.conCupo('lleno', dueño.fn);
    const esperas = Array.from({ length: 64 }, (_, i) =>
      resultado(cupo.conCupo('lleno', async () => i)),
    );
    const rechazada = await resultado(cupo.conCupo('lleno', async () => 'no cabe'));
    esDemasiadosALaVez('error' in rechazada ? rechazada.error : undefined);
    // Otro grupo tiene su propia cola: sigue cabiendo.
    const deOtro = resultado(cupo.conCupo('otro', async () => 'cabe'));
    // Se vacía la cola: las 64 esperas y la del otro grupo corren, ninguna recibió 429.
    dueño.terminar();
    await vi.advanceTimersByTimeAsync(0);
    const todas = await Promise.all([pd, ...esperas, deOtro]);
    expect(todas.slice(1).every((r) => r !== undefined && 'valor' in (r as object))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('los grupos se turnan: un grupo con muchas esperas no hace esperar a otro más que un turno', async () => {
    const arranques: string[] = [];
    const dueño = tarea(arranques, 'dueño');
    const pd = cupo.conCupo('A', dueño.fn);
    const orden: string[] = [];
    const corre = (grupo: string, id: string) =>
      cupo.conCupo(grupo, async () => {
        orden.push(id);
      });
    // Llegan en este orden: A1, A2, A3, B1, C1.
    const todas = [
      corre('A', 'A1'),
      corre('A', 'A2'),
      corre('A', 'A3'),
      corre('B', 'B1'),
      corre('C', 'C1'),
    ];
    await turno(); // el dueño ya arrancó y las demás esperan en sus colas
    dueño.terminar();
    await turno();
    await Promise.all([pd, ...todas]);
    // Cada liberación da el cupo al primer grupo de la ronda y lo manda al final.
    expect(orden).toEqual(['A1', 'B1', 'C1', 'A2', 'A3']);
  });
});
