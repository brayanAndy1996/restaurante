// Historia 006 · caja, cobro y comprobantes, entrega 6b, grupo C9 (criterios 143 a 157 y 167, plan "Migraciones" 13): el
// registro de las notas de crédito. Dueño: caja.
//
// - `nota_credito`: una fila por operación de nota de crédito. Clave primaria `(empresa_id, id)`: el `id` lo genera la PWA y
//   se conserva hasta una respuesta final; el mismo UUID en otra empresa crea su propia fila (criterio 167). Lleva la nota
//   (`comprobante_id`, único: una nota, una operación), la factura de un cambio de boleta por factura (`factura_id`, solo
//   en `CAMBIO_A_FACTURA`), el original que acredita, el turno de la devolución (nulo sin devolución), el tipo, el total de
//   la nota, lo devuelto (no puede pasar del total), la huella de la entrada (réplica por `id`, criterio 153; sin `total`
//   ni `motivo`) y la respuesta original (la réplica la devuelve igual, aunque el turno ya esté cerrado).
//
// Tabla de empresa trazable (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). `restaurante_api` solo tiene SELECT e
// INSERT: la nota es inmutable (criterio 156). Las llaves foráneas compuestas con la empresa impiden referenciar un
// comprobante o un turno de otra empresa (criterio 167). Ninguna migración escribe datos.
//
// Los `CHECK` dan NULL con las columnas casi vacías (prueba de catálogo de 002, criterio 113). Las migraciones están
// exentas de la regla de ESLint de los nombres de funciones del contexto.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE nota_credito (
  id uuid NOT NULL,
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  -- La nota de crédito emitida.
  comprobante_id uuid NOT NULL,
  -- La factura nueva de un cambio de boleta por factura; nula en los demás tipos.
  factura_id uuid,
  -- El comprobante que se acredita.
  original_id uuid NOT NULL,
  -- El turno de la devolución; nulo sin devolución.
  turno_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('ANULACION', 'DEVOLUCION', 'CAMBIO_A_FACTURA')),
  total numeric(10, 2) NOT NULL CHECK (total >= 0),
  devuelto numeric(10, 2) NOT NULL CHECK (devuelto >= 0),
  -- SHA-256 de la entrada normalizada (sin total ni motivo), para reconocer la réplica por id (criterio 153).
  huella_entrada bytea NOT NULL CHECK (octet_length(huella_entrada) = 32),
  -- La respuesta original, para devolverla igual en la réplica.
  respuesta jsonb NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nota_credito_pk PRIMARY KEY (empresa_id, id),
  CONSTRAINT nota_credito_comprobante_fk
    FOREIGN KEY (comprobante_id, empresa_id) REFERENCES comprobante (id, empresa_id),
  CONSTRAINT nota_credito_factura_fk
    FOREIGN KEY (factura_id, empresa_id) REFERENCES comprobante (id, empresa_id),
  CONSTRAINT nota_credito_original_fk
    FOREIGN KEY (original_id, empresa_id) REFERENCES comprobante (id, empresa_id),
  CONSTRAINT nota_credito_turno_fk FOREIGN KEY (turno_id, empresa_id) REFERENCES turno (id, empresa_id),
  -- Una nota, una operación.
  CONSTRAINT nota_credito_comprobante_unico UNIQUE (empresa_id, comprobante_id),
  CONSTRAINT nota_credito_factura_ck CHECK ((tipo = 'CAMBIO_A_FACTURA') = (factura_id IS NOT NULL)),
  CONSTRAINT nota_credito_devuelto_ck CHECK (devuelto <= total)
);
CREATE INDEX nota_credito_empresa_id_idx ON nota_credito (empresa_id);
CREATE INDEX nota_credito_original_idx ON nota_credito (original_id);
${sqlTablaDeEmpresaTrazable('nota_credito', {
  privilegiosApi: ['SELECT', 'INSERT'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE nota_credito;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
