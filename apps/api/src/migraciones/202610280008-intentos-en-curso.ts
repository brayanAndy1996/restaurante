// Historia 002 · cuenta de intentos de ingreso con contraseña: "en curso" separado de "fallos" (cuarta ronda
// adversarial, R4-F1; criterios 11, 12 y 61).
//
// Hasta ahora la reserva de un intento lo contaba como fallo de antemano, así que un intento que llegaba con
// el cupo lleno (5 evaluaciones sin resolver) también contaba y, si todas eran correctas, dejaba un bloqueo
// de 15 minutos sin ningún fallo real. Ahora `fallos_seguidos` solo cuenta fallos resueltos y las
// evaluaciones que están corriendo se llevan aparte:
//
// - `en_curso`: evaluaciones reservadas que todavía no se resolvieron (se incrementa al reservar y se
//   decrementa al resolver, sea fallo, éxito o cancelación). La reserva se rechaza, sin contar y sin
//   bloquear, si `fallos_seguidos + en_curso` ya llega al umbral.
// - `en_curso_desde`: cuándo empezó la racha de evaluaciones sin resolver (la reserva que llevó `en_curso` de
//   0 a 1). Si pasan 60 s sin que `en_curso` vuelva a 0, esas reservas se dan por perdidas (el proceso murió
//   a media evaluación) y la cuenta no queda trabada.
//
// Se agregan a `bloqueo_intentos` (ámbito `CONTRASENA_USUARIO`; el resto de los ámbitos las deja en 0) y a
// `superadministrador`. Las políticas RLS y los permisos son por tabla y no cambian.
import type { ContextoMigracion } from './tipos';

const SQL_UP = `
ALTER TABLE bloqueo_intentos
  ADD COLUMN en_curso integer NOT NULL DEFAULT 0 CONSTRAINT bloqueo_intentos_en_curso_ck CHECK (en_curso >= 0),
  ADD COLUMN en_curso_desde timestamptz;

ALTER TABLE superadministrador
  ADD COLUMN en_curso integer NOT NULL DEFAULT 0 CONSTRAINT superadministrador_en_curso_ck CHECK (en_curso >= 0),
  ADD COLUMN en_curso_desde timestamptz;
`;

const SQL_DOWN = `
ALTER TABLE superadministrador DROP COLUMN en_curso_desde, DROP COLUMN en_curso;
ALTER TABLE bloqueo_intentos DROP COLUMN en_curso_desde, DROP COLUMN en_curso;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
