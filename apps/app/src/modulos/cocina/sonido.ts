/**
 * Aviso sonoro del KDS (criterio 96). Los navegadores no dejan sonar nada hasta que la persona toca la
 * pantalla, así que el `AudioContext` se crea y se despierta con el primer toque (`desbloquearSonido`); antes
 * de eso, la pantalla avisa "Toca la pantalla para activar el sonido".
 */

export interface MotorDeSonido {
  /** Despierta el audio con un gesto de la persona. Devuelve si ya puede sonar. */
  desbloquear(): boolean;
  /** `true` si ya puede sonar. */
  listo(): boolean;
  /** Suena el aviso corto de una comanda nueva. Devuelve si sonó. */
  avisar(): boolean;
}

type ConstructorDeAudio = new () => AudioContext;

/** El motor de verdad, con el `AudioContext` del navegador. Se exporta para probarlo con un contexto de mentira. */
export function crearMotorReal(): MotorDeSonido {
  let contexto: AudioContext | null = null;

  function obtener(): AudioContext | null {
    if (contexto) return contexto;
    const Constructor =
      typeof window === 'undefined'
        ? undefined
        : (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: ConstructorDeAudio }).webkitAudioContext);
    if (!Constructor) return null;
    try {
      contexto = new Constructor();
    } catch {
      return null;
    }
    return contexto;
  }

  const listo = () => contexto?.state === 'running';

  return {
    desbloquear() {
      const audio = obtener();
      if (audio && audio.state === 'suspended') void audio.resume().catch(() => undefined);
      return listo();
    },
    listo,
    avisar() {
      const audio = contexto;
      if (!audio || audio.state !== 'running') return false;
      // Dos notas cortas (la segunda más aguda): se oyen sobre el ruido de una cocina sin asustar.
      const inicio = audio.currentTime;
      [880, 1175].forEach((frecuencia, i) => {
        const oscilador = audio.createOscillator();
        const volumen = audio.createGain();
        const desde = inicio + i * 0.18;
        oscilador.type = 'sine';
        oscilador.frequency.value = frecuencia;
        volumen.gain.setValueAtTime(0.0001, desde);
        volumen.gain.exponentialRampToValueAtTime(0.4, desde + 0.02);
        volumen.gain.exponentialRampToValueAtTime(0.0001, desde + 0.16);
        oscilador.connect(volumen).connect(audio.destination);
        oscilador.start(desde);
        oscilador.stop(desde + 0.18);
      });
      return true;
    },
  };
}

let motor: MotorDeSonido | null = null;
let sustituto: MotorDeSonido | null = null;

export function motorDeSonido(): MotorDeSonido {
  if (sustituto) return sustituto;
  motor ??= crearMotorReal();
  return motor;
}

/** Solo para pruebas: cambia el motor de sonido. Sin argumento, vuelve al real. */
export function usarMotorDeSonido(nuevo?: MotorDeSonido): void {
  sustituto = nuevo ?? null;
}
