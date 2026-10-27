import { DataTypes, Model, type ModelStatic, type Sequelize } from 'sequelize';

/** Atributos de cada tabla (camelCase en el modelo; columnas snake_case por `underscored`). */
export interface EmpresaAtributos {
  id: string;
  nombre: string;
  creadoEn: Date;
  actualizadoEn: Date;
}

export interface EmisorAtributos {
  id: string;
  empresaId: string;
  ruc: string;
  razonSocial: string;
  regimen: 'NUEVO_RUS' | 'RER' | 'MYPE_TRIBUTARIO' | 'GENERAL';
  creadoEn: Date;
  actualizadoEn: Date;
}

export interface TramoJson {
  dia: number;
  desde: string;
  hasta: string;
}

export interface SucursalAtributos {
  id: string;
  empresaId: string;
  emisorId: string;
  nombre: string;
  codigoEstablecimiento: string;
  direccion: string;
  horario: TramoJson[];
  whatsapp: string | null;
  /** `HH:MM:SS` al leer de la base; `HH:MM` al escribir. */
  horaCorte: string;
  creadoEn: Date;
  actualizadoEn: Date;
}

export interface AuditoriaPlataformaAtributos {
  id: string;
  ocurridoEn: Date;
  actor: string;
  operacion: string;
  motivo: string;
  empresaId: string | null;
  detalle: unknown;
}

type Opcional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type EmpresaModelo = Model<
  EmpresaAtributos,
  Opcional<EmpresaAtributos, 'id' | 'creadoEn' | 'actualizadoEn'>
> &
  EmpresaAtributos;
export type EmisorModelo = Model<
  EmisorAtributos,
  Opcional<EmisorAtributos, 'id' | 'creadoEn' | 'actualizadoEn'>
> &
  EmisorAtributos;
export type SucursalModelo = Model<
  SucursalAtributos,
  Opcional<
    SucursalAtributos,
    'id' | 'creadoEn' | 'actualizadoEn' | 'horario' | 'whatsapp' | 'horaCorte'
  >
> &
  SucursalAtributos;
export type AuditoriaPlataformaModelo = Model<
  AuditoriaPlataformaAtributos,
  Opcional<AuditoriaPlataformaAtributos, 'id' | 'ocurridoEn' | 'empresaId' | 'detalle'>
> &
  AuditoriaPlataformaAtributos;

export interface Modelos {
  Empresa: ModelStatic<EmpresaModelo>;
  Emisor: ModelStatic<EmisorModelo>;
  Sucursal: ModelStatic<SucursalModelo>;
  /** Solo existe en la instancia de plataforma: la API no tiene ningún privilegio sobre la tabla. */
  AuditoriaPlataforma?: ModelStatic<AuditoriaPlataformaModelo>;
}

export interface OpcionesModelos {
  /** Define también `AuditoriaPlataforma` (solo la instancia de plataforma). */
  conAuditoria: boolean;
}

const COLUMNAS_DE_TIEMPO = {
  creadoEn: { type: DataTypes.DATE, allowNull: false },
  actualizadoEn: { type: DataTypes.DATE, allowNull: false },
} as const;

const MARCAS_DE_TIEMPO = {
  timestamps: true,
  createdAt: 'creadoEn',
  updatedAt: 'actualizadoEn',
} as const;

/**
 * Define los modelos sobre una instancia de Sequelize. Cada instancia (API y plataforma) tiene su
 * propio juego de modelos, así que cada modelo solo habla por la conexión de su instancia.
 */
export function definirModelos(sequelize: Sequelize, opciones: OpcionesModelos): Modelos {
  const Empresa = sequelize.define<EmpresaModelo>(
    'Empresa',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      nombre: { type: DataTypes.TEXT, allowNull: false },
      ...COLUMNAS_DE_TIEMPO,
    },
    { tableName: 'empresa', ...MARCAS_DE_TIEMPO },
  );

  const Emisor = sequelize.define<EmisorModelo>(
    'Emisor',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      empresaId: { type: DataTypes.UUID, allowNull: false },
      ruc: { type: DataTypes.CHAR(11), allowNull: false },
      razonSocial: { type: DataTypes.TEXT, allowNull: false },
      regimen: { type: DataTypes.TEXT, allowNull: false },
      ...COLUMNAS_DE_TIEMPO,
    },
    { tableName: 'emisor', ...MARCAS_DE_TIEMPO },
  );

  const Sucursal = sequelize.define<SucursalModelo>(
    'Sucursal',
    {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      empresaId: { type: DataTypes.UUID, allowNull: false },
      emisorId: { type: DataTypes.UUID, allowNull: false },
      nombre: { type: DataTypes.TEXT, allowNull: false },
      codigoEstablecimiento: { type: DataTypes.CHAR(4), allowNull: false },
      direccion: { type: DataTypes.TEXT, allowNull: false },
      horario: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      whatsapp: { type: DataTypes.TEXT, allowNull: true },
      horaCorte: { type: DataTypes.TIME, allowNull: false, defaultValue: '05:00' },
      ...COLUMNAS_DE_TIEMPO,
    },
    { tableName: 'sucursal', ...MARCAS_DE_TIEMPO },
  );

  const modelos: Modelos = { Empresa, Emisor, Sucursal };

  if (opciones.conAuditoria) {
    modelos.AuditoriaPlataforma = sequelize.define<AuditoriaPlataformaModelo>(
      'AuditoriaPlataforma',
      {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
        ocurridoEn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        actor: { type: DataTypes.TEXT, allowNull: false },
        operacion: { type: DataTypes.TEXT, allowNull: false },
        motivo: { type: DataTypes.TEXT, allowNull: false },
        empresaId: { type: DataTypes.UUID, allowNull: true },
        detalle: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      },
      { tableName: 'auditoria_plataforma', timestamps: false },
    );
  }
  return modelos;
}
