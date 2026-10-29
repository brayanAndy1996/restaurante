// Historia 004 · salón y cocina, grupo C2 (criterios 9 a 14, 16, 22 a 24, 26, 32, 55 y 82 a 86): las tablas de
// pedidos de la entrega 3a, salvo `anulacion_item` y `precuenta`, que llegan con la migración
// `202610300003-anulaciones-precuentas` (T22).
//
// - `orden`: la cuenta (tipo, canal, estado, mozo responsable, comensales). `version` sube con cada cambio de
//   ítems o mesas y sirve para saber si una pre-cuenta sigue vigente. `unida_a_orden_id` apunta a la orden que
//   absorbió a esta cuando queda `UNIDA`.
// - `orden_mesa`: la relación entre una orden y sus mesas con su historial (`desde`, `hasta`). La mesa está
//   ocupada mientras tenga una fila con `hasta IS NULL`; el índice único parcial lo hace cumplir en la base
//   (criterio 11), y la apertura toma además la fila de la mesa para turnarse.
// - `envio`, `item`, `comanda`, `comanda_linea` y `marcha`: lo que se envía a cocina. El ítem guarda la línea
//   preparada completa en `linea` (criterio 16) y sus columnas propias; las comandas y sus líneas guardan lo que
//   ve cada estación. `envio` y `marcha` guardan la `huella_entrada` de lo pedido para reconocer la réplica.
// - Las tablas cuyo id lo genera la PWA (`orden`, `envio`, `marcha`) tienen clave primaria `(empresa_id, id)`:
//   el mismo UUID usado en otra empresa crea su propia fila sin chocar ni revelar que existe (criterio 85). Las
//   llaves foráneas hacia ellas usan `(…_id, empresa_id)` y las respalda esa clave. Todos los índices únicos
//   llevan `empresa_id` por la misma razón.
// - Todas son tablas de empresa trazables (`sqlTablaDeEmpresaTrazable`, con `llaveDeEquipo`). Privilegios de
//   `restaurante_api` (spec, "Permisos"): SELECT, INSERT y UPDATE en `orden`, `orden_mesa`, `item`, `comanda` y
//   `comanda_linea`; solo SELECT e INSERT en `envio` y `marcha` (no se corrigen). Nada se borra. Ninguna
//   migración escribe datos.
//
// `down` borra las siete tablas con sus datos; las de `202610300003` las referencian y se revierten antes.
import type { ContextoMigracion } from './tipos';
import { sqlTablaDeEmpresaTrazable } from './sql-tabla-de-empresa';

const SQL_UP = `
CREATE TABLE orden (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  sucursal_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('MESA', 'MOSTRADOR', 'PARA_LLEVAR', 'DELIVERY')),
  canal text NOT NULL CHECK (canal IN ('SALON', 'WEB', 'TELEFONO')),
  estado text NOT NULL
    CHECK (estado IN ('ABIERTA', 'EN_PRECUENTA', 'ANULADA', 'UNIDA', 'CERRADA')),
  -- La persona a la que se atribuyen las ventas; solo una orden que no es de mesa puede no tenerla.
  mozo_id uuid,
  comensales smallint NOT NULL CHECK (comensales BETWEEN 1 AND 99),
  abierta_en timestamptz NOT NULL,
  anulada_en timestamptz,
  motivo_anulacion text
    CHECK (motivo_anulacion IS NULL OR char_length(motivo_anulacion) BETWEEN 1 AND 300),
  sin_consumo boolean NOT NULL DEFAULT false,
  -- La orden a la que se unió esta, si quedó UNIDA.
  unida_a_orden_id uuid,
  cerrada_en timestamptz,
  -- Sube con cada cambio de ítems o mesas; la pre-cuenta vigente es igual si su version_orden coincide.
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orden_pk PRIMARY KEY (empresa_id, id),
  CONSTRAINT orden_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT orden_mozo_fk FOREIGN KEY (mozo_id, empresa_id) REFERENCES usuario (id, empresa_id),
  CONSTRAINT orden_unida_a_fk
    FOREIGN KEY (unida_a_orden_id, empresa_id) REFERENCES orden (id, empresa_id),
  -- Llave de la comanda: su orden es de la misma sucursal y de la misma empresa.
  CONSTRAINT orden_id_sucursal_empresa_unico UNIQUE (id, sucursal_id, empresa_id),
  CONSTRAINT orden_mozo_ck CHECK (mozo_id IS NOT NULL OR tipo <> 'MESA'),
  CONSTRAINT orden_unida_ck CHECK ((estado = 'UNIDA') = (unida_a_orden_id IS NOT NULL)),
  CONSTRAINT orden_anulada_ck CHECK ((estado = 'ANULADA') = (anulada_en IS NOT NULL)),
  CONSTRAINT orden_cerrada_ck CHECK ((estado = 'CERRADA') = (cerrada_en IS NOT NULL))
);
CREATE INDEX orden_empresa_id_idx ON orden (empresa_id);
CREATE INDEX orden_sucursal_estado_idx ON orden (sucursal_id, estado);
${sqlTablaDeEmpresaTrazable('orden', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE orden_mesa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  orden_id uuid NOT NULL,
  mesa_id uuid NOT NULL,
  desde timestamptz NOT NULL,
  hasta timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orden_mesa_orden_fk FOREIGN KEY (orden_id, empresa_id) REFERENCES orden (id, empresa_id),
  CONSTRAINT orden_mesa_mesa_fk FOREIGN KEY (mesa_id, empresa_id) REFERENCES mesa (id, empresa_id),
  CONSTRAINT orden_mesa_id_empresa_unico UNIQUE (id, empresa_id),
  CONSTRAINT orden_mesa_periodo_ck CHECK (hasta IS NULL OR hasta >= desde)
);
CREATE INDEX orden_mesa_empresa_id_idx ON orden_mesa (empresa_id);
CREATE INDEX orden_mesa_orden_idx ON orden_mesa (orden_id);
-- Una mesa, una orden abierta (criterio 11): la relación vigente es la que no tiene fecha de fin.
CREATE UNIQUE INDEX orden_mesa_vigente_unica ON orden_mesa (empresa_id, mesa_id) WHERE hasta IS NULL;
${sqlTablaDeEmpresaTrazable('orden_mesa', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE envio (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  -- La orden donde se creó; no cambia al unir mesas.
  orden_id uuid NOT NULL,
  numero smallint NOT NULL CHECK (numero >= 1),
  es_adicion boolean NOT NULL,
  -- SHA-256 de las líneas normalizadas, para reconocer la réplica (criterio 26).
  huella_entrada bytea NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT envio_pk PRIMARY KEY (empresa_id, id),
  CONSTRAINT envio_orden_fk FOREIGN KEY (orden_id, empresa_id) REFERENCES orden (id, empresa_id)
);
CREATE INDEX envio_empresa_id_idx ON envio (empresa_id);
CREATE UNIQUE INDEX envio_numero_unico ON envio (empresa_id, orden_id, numero);
${sqlTablaDeEmpresaTrazable('envio', {
  privilegiosApi: ['SELECT', 'INSERT'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  -- La orden vigente del ítem; cambia al unir mesas.
  orden_id uuid NOT NULL,
  envio_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 100),
  tipo_producto text NOT NULL CHECK (tipo_producto IN ('SIMPLE', 'COMBO', 'MENU_DEL_DIA')),
  cantidad smallint NOT NULL CHECK (cantidad BETWEEN 1 AND 999),
  cantidad_anulada smallint NOT NULL DEFAULT 0,
  precio_unitario numeric(10, 2) NOT NULL CHECK (precio_unitario >= 0),
  -- Precio unitario por cantidad enviada, sin descontar lo anulado.
  total numeric(10, 2) NOT NULL,
  afectacion_igv text NOT NULL CHECK (afectacion_igv IN ('GRAVADO', 'EXONERADO', 'INAFECTO')),
  aplica_icbper boolean NOT NULL,
  -- La línea preparada completa, tal como se vendió (criterio 16).
  linea jsonb NOT NULL,
  observacion text CHECK (observacion IS NULL OR char_length(observacion) BETWEEN 1 AND 140),
  tiempo smallint NOT NULL CHECK (tiempo IN (1, 2)),
  para_llevar boolean NOT NULL,
  es_adicion boolean NOT NULL,
  marchado_en timestamptz,
  estado text NOT NULL CHECK (estado IN ('ENVIADO', 'ANULADO')),
  -- Posición dentro del envío (el orden de las líneas enviadas).
  posicion smallint NOT NULL CHECK (posicion >= 1),
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_orden_fk FOREIGN KEY (orden_id, empresa_id) REFERENCES orden (id, empresa_id),
  CONSTRAINT item_envio_fk FOREIGN KEY (envio_id, empresa_id) REFERENCES envio (id, empresa_id),
  CONSTRAINT item_producto_fk
    FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT item_id_empresa_unico UNIQUE (id, empresa_id),
  CONSTRAINT item_cantidad_anulada_ck CHECK (cantidad_anulada BETWEEN 0 AND cantidad),
  CONSTRAINT item_total_ck CHECK (total = precio_unitario * cantidad),
  CONSTRAINT item_estado_ck CHECK ((estado = 'ANULADO') = (cantidad_anulada = cantidad))
);
CREATE INDEX item_empresa_id_idx ON item (empresa_id);
CREATE INDEX item_orden_idx ON item (orden_id);
CREATE INDEX item_envio_idx ON item (envio_id);
${sqlTablaDeEmpresaTrazable('item', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE comanda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  -- Copiada de la orden, para que el KDS lea por sucursal sin pasar por la orden.
  sucursal_id uuid NOT NULL,
  -- La orden de origen; no cambia al unir mesas.
  orden_id uuid NOT NULL,
  estacion_id uuid NOT NULL,
  envio_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('COMANDA', 'ADICION', 'MARCHAR', 'ANULACION')),
  -- Guardado al crearse: cambiar el destino de una estación no mueve comandas ya enviadas.
  destino text NOT NULL CHECK (destino IN ('KDS', 'IMPRESORA')),
  -- El id de la marcha o de la anulación de la que sale la comanda.
  origen_id uuid,
  vista_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comanda_sucursal_fk
    FOREIGN KEY (sucursal_id, empresa_id) REFERENCES sucursal (id, empresa_id),
  CONSTRAINT comanda_orden_fk
    FOREIGN KEY (orden_id, sucursal_id, empresa_id)
    REFERENCES orden (id, sucursal_id, empresa_id),
  CONSTRAINT comanda_estacion_fk
    FOREIGN KEY (estacion_id, empresa_id) REFERENCES estacion (id, empresa_id),
  CONSTRAINT comanda_envio_fk FOREIGN KEY (envio_id, empresa_id) REFERENCES envio (id, empresa_id),
  CONSTRAINT comanda_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX comanda_empresa_id_idx ON comanda (empresa_id);
CREATE INDEX comanda_sucursal_creada_idx ON comanda (sucursal_id, creado_en);
CREATE INDEX comanda_orden_idx ON comanda (orden_id);
${sqlTablaDeEmpresaTrazable('comanda', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE comanda_linea (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  comanda_id uuid NOT NULL,
  item_id uuid NOT NULL,
  rol text NOT NULL CHECK (rol IN ('PRODUCTO', 'COMPONENTE', 'LIGADO')),
  producto_id uuid NOT NULL,
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 100),
  -- El combo o el producto del que sale la parte ("Combo hamburguesa").
  contexto text CHECK (contexto IS NULL OR char_length(contexto) BETWEEN 1 AND 100),
  -- 1 para el producto y los ligados; la cantidad del componente para un componente. La cantidad vigente de la
  -- línea es cantidad_por_item por la cantidad vigente del ítem.
  cantidad_por_item smallint NOT NULL CHECK (cantidad_por_item >= 1),
  -- Solo en las comandas MARCHAR y ANULACION: la cantidad fija de esa comanda.
  cantidad smallint CHECK (cantidad IS NULL OR cantidad >= 1),
  modificadores jsonb NOT NULL DEFAULT '[]'::jsonb,
  observacion text CHECK (observacion IS NULL OR char_length(observacion) BETWEEN 1 AND 140),
  tiempo smallint NOT NULL CHECK (tiempo IN (1, 2)),
  para_llevar boolean NOT NULL,
  esperar boolean NOT NULL,
  estado text NOT NULL CHECK (estado IN ('ENVIADO', 'EN_PREPARACION', 'LISTO', 'ANULADO')),
  estado_en timestamptz NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comanda_linea_comanda_fk
    FOREIGN KEY (comanda_id, empresa_id) REFERENCES comanda (id, empresa_id),
  CONSTRAINT comanda_linea_item_fk FOREIGN KEY (item_id, empresa_id) REFERENCES item (id, empresa_id),
  CONSTRAINT comanda_linea_producto_fk
    FOREIGN KEY (producto_id, empresa_id) REFERENCES producto (id, empresa_id),
  CONSTRAINT comanda_linea_id_empresa_unico UNIQUE (id, empresa_id)
);
CREATE INDEX comanda_linea_empresa_id_idx ON comanda_linea (empresa_id);
CREATE INDEX comanda_linea_comanda_idx ON comanda_linea (comanda_id);
CREATE INDEX comanda_linea_item_idx ON comanda_linea (item_id);
${sqlTablaDeEmpresaTrazable('comanda_linea', {
  privilegiosApi: ['SELECT', 'INSERT', 'UPDATE'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}

CREATE TABLE marcha (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa (id),
  orden_id uuid NOT NULL,
  -- SHA-256 de los ítems pedidos, para reconocer la réplica (criterio 32).
  huella_entrada bytea NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marcha_pk PRIMARY KEY (empresa_id, id),
  CONSTRAINT marcha_orden_fk FOREIGN KEY (orden_id, empresa_id) REFERENCES orden (id, empresa_id)
);
CREATE INDEX marcha_empresa_id_idx ON marcha (empresa_id);
CREATE INDEX marcha_orden_idx ON marcha (orden_id);
${sqlTablaDeEmpresaTrazable('marcha', {
  privilegiosApi: ['SELECT', 'INSERT'],
  privilegiosPlataforma: [],
  llaveDeEquipo: true,
})}
`;

const SQL_DOWN = `
DROP TABLE comanda_linea;
DROP TABLE comanda;
DROP TABLE item;
DROP TABLE marcha;
DROP TABLE envio;
DROP TABLE orden_mesa;
DROP TABLE orden;
`;

export async function up({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_UP, { transaction });
}

export async function down({ sequelize, transaction }: ContextoMigracion): Promise<void> {
  await sequelize.query(SQL_DOWN, { transaction });
}
