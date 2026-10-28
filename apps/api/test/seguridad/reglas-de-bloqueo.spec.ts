// Pruebas del desarrollador (no protegidas) de I-4 e I-5: la regla de bloqueo compartida por las personas de
// empresa y el superadministrador (`decidirReserva`, `resolverFalloEnFila`) y los errores compartidos.
import { describe, expect, it, vi } from 'vitest';
import {
  VIGENCIA_RESERVA_MS,
  decidirReserva,
  resolverFalloEnFila,
  segundosHasta,
  type FilaBloqueo,
} from '../../src/modulos/seguridad/bloqueos.service';
import {
  bloqueoTemporal,
  credencialesInvalidas,
  errorDeReserva,
} from '../../src/modulos/seguridad/errores-acceso';

const AHORA = new Date('2026-11-02T10:00:00-05:00');
const en = (ms: number) => new Date(AHORA.getTime() + ms);
const UMBRAL = 5;

const fila = (parcial: Partial<FilaBloqueo> = {}): FilaBloqueo => ({
  fallos_seguidos: 0,
  en_curso: 0,
  en_curso_desde: null,
  bloqueado_hasta: null,
  ...parcial,
});

describe('decidirReserva', () => {
  it('la vigencia por defecto de una reserva es de 60 s', () => {
    expect(VIGENCIA_RESERVA_MS).toBe(60_000);
  });

  it('sin fila de intentos se puede reservar, con la cuenta en cero', () => {
    expect(decidirReserva(undefined, AHORA, { umbral: UMBRAL })).toEqual({
      permitido: true,
      fallos: 0,
      enCurso: 0,
      desde: null,
    });
  });

  describe('bloqueo', () => {
    it('vigente: rechaza con BLOQUEO y el fin del bloqueo, sin importar fallos ni evaluaciones en curso', () => {
      const hasta = en(1);
      for (const parcial of [
        { fallos_seguidos: 5 },
        { fallos_seguidos: 0 },
        { fallos_seguidos: 2, en_curso: 3, en_curso_desde: AHORA },
      ]) {
        expect(
          decidirReserva(fila({ ...parcial, bloqueado_hasta: hasta }), AHORA, { umbral: UMBRAL }),
        ).toEqual({ permitido: false, motivo: 'BLOQUEO', bloqueadoHasta: hasta });
      }
    });

    it('que vence justo ahora ya no bloquea (solo bloquea mientras sea posterior a la hora de la API)', () => {
      const decision = decidirReserva(fila({ fallos_seguidos: 5, bloqueado_hasta: AHORA }), AHORA, {
        umbral: UMBRAL,
      });
      expect(decision).toEqual({ permitido: true, fallos: 0, enCurso: 0, desde: null });
    });

    it('vencido: la cuenta de fallos empieza de cero', () => {
      const decision = decidirReserva(
        fila({ fallos_seguidos: 5, bloqueado_hasta: en(-60_000) }),
        AHORA,
        { umbral: UMBRAL },
      );
      expect(decision).toEqual({ permitido: true, fallos: 0, enCurso: 0, desde: null });
    });

    it('vencido: las evaluaciones en curso vigentes siguen contando', () => {
      const desde = en(-10_000);
      const permitido = decidirReserva(
        fila({ bloqueado_hasta: en(-1), fallos_seguidos: 5, en_curso: 4, en_curso_desde: desde }),
        AHORA,
        { umbral: UMBRAL },
      );
      expect(permitido).toEqual({ permitido: true, fallos: 0, enCurso: 4, desde });
      const llena = decidirReserva(
        fila({ bloqueado_hasta: en(-1), fallos_seguidos: 5, en_curso: 5, en_curso_desde: desde }),
        AHORA,
        { umbral: UMBRAL },
      );
      expect(llena).toEqual({ permitido: false, motivo: 'CUPO_LLENO' });
    });
  });

  describe('reservas perdidas (nadie las resolvió)', () => {
    it('a los 60 s exactos se dan por perdidas; un milisegundo antes todavía cuentan', () => {
      const vigente = decidirReserva(
        fila({ en_curso: 2, en_curso_desde: en(-(VIGENCIA_RESERVA_MS - 1)) }),
        AHORA,
        { umbral: UMBRAL },
      );
      expect(vigente).toMatchObject({ permitido: true, enCurso: 2 });
      const perdida = decidirReserva(
        fila({ en_curso: 2, en_curso_desde: en(-VIGENCIA_RESERVA_MS) }),
        AHORA,
        { umbral: UMBRAL },
      );
      expect(perdida).toEqual({ permitido: true, fallos: 0, enCurso: 0, desde: null });
    });

    it('en curso sin fecha de inicio se da por perdido', () => {
      expect(
        decidirReserva(fila({ en_curso: 3, en_curso_desde: null }), AHORA, { umbral: UMBRAL }),
      ).toMatchObject({ permitido: true, enCurso: 0, desde: null });
    });

    it('descartarlas libera el cupo: con 3 fallos y 2 en curso perdidos se puede reservar', () => {
      const llena = decidirReserva(
        fila({ fallos_seguidos: 3, en_curso: 2, en_curso_desde: en(-1_000) }),
        AHORA,
        { umbral: UMBRAL },
      );
      expect(llena).toEqual({ permitido: false, motivo: 'CUPO_LLENO' });
      const libre = decidirReserva(
        fila({ fallos_seguidos: 3, en_curso: 2, en_curso_desde: en(-61_000) }),
        AHORA,
        { umbral: UMBRAL },
      );
      expect(libre).toEqual({ permitido: true, fallos: 3, enCurso: 0, desde: null });
    });

    it('respeta una vigencia propia', () => {
      const f = fila({ en_curso: 1, en_curso_desde: en(-5_000) });
      expect(decidirReserva(f, AHORA, { umbral: UMBRAL, vigenciaReservaMs: 5_001 })).toMatchObject({
        enCurso: 1,
      });
      expect(decidirReserva(f, AHORA, { umbral: UMBRAL, vigenciaReservaMs: 5_000 })).toMatchObject({
        enCurso: 0,
      });
    });
  });

  describe('umbral de fallos más evaluaciones en curso', () => {
    const conEnCurso = (fallos: number, enCurso: number) =>
      decidirReserva(
        fila({
          fallos_seguidos: fallos,
          en_curso: enCurso,
          en_curso_desde: enCurso > 0 ? en(-1_000) : null,
        }),
        AHORA,
        { umbral: UMBRAL },
      );

    it.each([
      [0, 0, true],
      [4, 0, true],
      [0, 4, true],
      [2, 2, true],
      [3, 1, true],
      [5, 0, false], // en el umbral
      [0, 5, false],
      [3, 2, false],
      [2, 4, false], // por encima del umbral
    ])('%s fallos y %s en curso: permitido=%s', (fallos, enCurso, permitido) => {
      const decision = conEnCurso(fallos, enCurso);
      expect(decision.permitido).toBe(permitido);
      if (!permitido) expect(decision).toEqual({ permitido: false, motivo: 'CUPO_LLENO' });
      else expect(decision).toMatchObject({ fallos, enCurso });
    });

    it('un umbral distinto cambia dónde se llena', () => {
      const f = fila({ fallos_seguidos: 1, en_curso: 1, en_curso_desde: en(-1) });
      expect(decidirReserva(f, AHORA, { umbral: 3 }).permitido).toBe(true);
      expect(decidirReserva(f, AHORA, { umbral: 2 }).permitido).toBe(false);
    });

    it('devuelve el inicio de la racha de evaluaciones en curso', () => {
      const desde = en(-7_000);
      expect(
        decidirReserva(fila({ en_curso: 1, en_curso_desde: desde }), AHORA, { umbral: UMBRAL }),
      ).toEqual({ permitido: true, fallos: 0, enCurso: 1, desde });
    });
  });
});

describe('resolverFalloEnFila', () => {
  const DURACION = 15 * 60_000;
  const opciones = { umbral: UMBRAL, duracionMs: DURACION };

  const adaptador = (
    fila: { fallos_seguidos: number; bloqueado_hasta: Date | null },
    bloquea = true,
  ) => ({
    contar: vi.fn(async () => fila),
    bloquear: vi.fn(async (_hasta: Date) => bloquea),
  });

  it('por debajo del umbral cuenta el fallo y no intenta bloquear', async () => {
    const a = adaptador({ fallos_seguidos: 4, bloqueado_hasta: null });
    await expect(resolverFalloEnFila(a, AHORA, opciones)).resolves.toEqual({
      fallosSeguidos: 4,
      bloqueadoHasta: null,
      bloqueoNuevo: false,
    });
    expect(a.contar).toHaveBeenCalledTimes(1);
    expect(a.bloquear).not.toHaveBeenCalled();
  });

  it('al llegar al umbral bloquea desde ahora por la duración y lo informa una vez', async () => {
    const a = adaptador({ fallos_seguidos: 5, bloqueado_hasta: null });
    const r = await resolverFalloEnFila(a, AHORA, opciones);
    expect(r).toEqual({ fallosSeguidos: 5, bloqueadoHasta: en(DURACION), bloqueoNuevo: true });
    expect(a.bloquear).toHaveBeenCalledWith(en(DURACION));
  });

  it('con un bloqueo vigente (de otros fallos) no bloquea de nuevo ni lo alarga: lo devuelve tal cual', async () => {
    const vigente = en(5 * 60_000);
    const a = adaptador({ fallos_seguidos: 7, bloqueado_hasta: vigente });
    await expect(resolverFalloEnFila(a, AHORA, opciones)).resolves.toEqual({
      fallosSeguidos: 7,
      bloqueadoHasta: vigente,
      bloqueoNuevo: false,
    });
    expect(a.bloquear).not.toHaveBeenCalled();
  });

  it('si otro fallo concurrente ya puso el bloqueo (bloquear devuelve false), este no lo informa como nuevo', async () => {
    const a = adaptador({ fallos_seguidos: 6, bloqueado_hasta: null }, false);
    await expect(resolverFalloEnFila(a, AHORA, opciones)).resolves.toEqual({
      fallosSeguidos: 6,
      bloqueadoHasta: null,
      bloqueoNuevo: false,
    });
    expect(a.bloquear).toHaveBeenCalledTimes(1);
  });

  it('respeta el umbral y la duración que recibe', async () => {
    const a = adaptador({ fallos_seguidos: 3, bloqueado_hasta: null });
    const r = await resolverFalloEnFila(a, AHORA, { umbral: 3, duracionMs: 1_000 });
    expect(r).toEqual({ fallosSeguidos: 3, bloqueadoHasta: en(1_000), bloqueoNuevo: true });
  });

  it('un error al contar o al bloquear se propaga', async () => {
    await expect(
      resolverFalloEnFila(
        {
          contar: async () => {
            throw new Error('base caída');
          },
          bloquear: async () => true,
        },
        AHORA,
        opciones,
      ),
    ).rejects.toThrow('base caída');
  });
});

describe('errores compartidos de acceso', () => {
  it('credencialesInvalidas es el 401 de siempre, sin distinguir usuario ni contraseña', () => {
    const error = credencialesInvalidas();
    expect(error.getStatus()).toBe(401);
    expect(error).toMatchObject({
      codigo: 'CREDENCIALES_INVALIDAS',
      message: 'Usuario o contraseña incorrectos',
    });
  });

  it('bloqueoTemporal es 429 con los segundos que faltan, redondeados hacia arriba y con mínimo de 1', () => {
    expect(bloqueoTemporal(en(90_000), AHORA)).toMatchObject({
      codigo: 'BLOQUEO_TEMPORAL',
      reintentarEnSegundos: 90,
    });
    expect(bloqueoTemporal(en(90_001), AHORA).reintentarEnSegundos).toBe(91);
    expect(bloqueoTemporal(en(1), AHORA).reintentarEnSegundos).toBe(1);
    expect(bloqueoTemporal(en(-5_000), AHORA).reintentarEnSegundos).toBe(1);
    expect(bloqueoTemporal(en(1), AHORA).getStatus()).toBe(429);
    expect(segundosHasta(en(2_000), AHORA)).toBe(2);
  });

  it('errorDeReserva: bloqueo vigente con su duración; cupo lleno con 1 s; el mismo código y mensaje', () => {
    const bloqueo = errorDeReserva({ motivo: 'BLOQUEO', bloqueadoHasta: en(30_000) }, AHORA);
    const lleno = errorDeReserva({ motivo: 'CUPO_LLENO' }, AHORA);
    expect(bloqueo).toMatchObject({ codigo: 'BLOQUEO_TEMPORAL', reintentarEnSegundos: 30 });
    expect(lleno).toMatchObject({ codigo: 'BLOQUEO_TEMPORAL', reintentarEnSegundos: 1 });
    expect(lleno.message).toBe(bloqueo.message);
    expect(lleno.getStatus()).toBe(429);
  });
});
