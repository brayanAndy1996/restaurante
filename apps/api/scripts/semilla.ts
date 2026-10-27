// pnpm db:semilla  ->  datos de demostración. Idempotente: lo que ya existe (el superadministrador, una empresa
// con el mismo nombre) no se vuelve a crear.
//
// - Un superadministrador de demostración (`superadmin`, contraseña de SUPERADMIN_CONTRASENA o la de
//   demostración de abajo), con `crearSuperadministrador` (actor `cli:superadmin`).
// - Dos empresas de demostración por la vía de plataforma (`PlataformaEmpresasService`, actor `semilla`, que
//   también es el actor de trazabilidad), cada una con su primer Administrador y usuarios de demostración
//   por rol, con contraseña temporal (se cambia en el primer ingreso) y PIN. Los PIN solo se muestran al
//   crearlos: la semilla los imprime. Uno de los usuarios lleva un horario de acceso de ejemplo.
//
// Son datos y contraseñas públicas de demostración: la semilla se niega a correr con NODE_ENV=production.
// Toma DATABASE_URL y DATABASE_PLATAFORMA_URL del entorno o del .env; si faltan, las deriva de
// DATABASE_ADMIN_URL (roles de la aplicación, base `restaurante`).
import 'reflect-metadata';
import type { RegistrarEmpresaEntrada, UsuarioCrearEntrada } from '@restaurante/contratos';
import { crearAplicacion } from '../src/aplicacion';
import { PlataformaEmpresasService } from '../src/modulos/plataforma';
import { UsuariosService } from '../src/modulos/seguridad';
import { ContextoEmpresa } from '../src/nucleo/contexto-empresa';
import { prepararEntornoDeScript } from './lib/entorno-scripts';
import {
  SuperadministradorExistenteError,
  crearSuperadministrador,
} from './lib/superadministrador';

const AUDITORIA = { actor: 'semilla', motivo: 'Datos de demostración (pnpm db:semilla)' };

const SUPERADMIN_USUARIO = 'superadmin';
const SUPERADMIN_CONTRASENA_DEMO = 'Superadmin-Demo-1';
/** Contraseña temporal de todos los usuarios de demostración (se cambia en el primer ingreso). */
const CONTRASENA_TEMPORAL_DEMO = 'Temporal-Demo-1';

/** Horario de ejemplo: todos los días de las 11:00 a las 23:00 (hora de Lima). */
const HORARIO_DE_EJEMPLO = [1, 2, 3, 4, 5, 6, 7].map((dia) => ({
  dia,
  desde: '11:00',
  hasta: '23:00',
}));

interface UsuarioDemo {
  nombre: string;
  nombreUsuario: string;
  esAdministrador?: boolean;
  /** Accesos por nombre de sucursal. */
  accesos?: { sucursal: string; rol: 'MOZO' | 'CAJERO' | 'COCINA_BARRA' | 'SUPERVISOR' }[];
  horario?: UsuarioCrearEntrada['horario'];
}

/** Usuarios de demostración por empresa (además del primer Administrador del alta). */
const USUARIOS_DE_DEMOSTRACION: Record<string, UsuarioDemo[]> = {
  'Demo · Restaurante El Fogón': [
    {
      nombre: 'Rosa Quispe (Supervisora)',
      nombreUsuario: 'fogon.supervisor',
      accesos: [{ sucursal: 'El Fogón · Miraflores', rol: 'SUPERVISOR' }],
    },
    {
      nombre: 'Carlos Ramos (Cajero)',
      nombreUsuario: 'fogon.cajero',
      accesos: [{ sucursal: 'El Fogón · Miraflores', rol: 'CAJERO' }],
    },
    {
      nombre: 'Lucía Torres (Mozo en dos sucursales)',
      nombreUsuario: 'fogon.mozo',
      accesos: [
        { sucursal: 'El Fogón · Miraflores', rol: 'MOZO' },
        { sucursal: 'El Fogón · San Isidro', rol: 'MOZO' },
      ],
    },
    {
      nombre: 'Pedro Flores (Cocina, con horario)',
      nombreUsuario: 'fogon.cocina',
      accesos: [{ sucursal: 'El Fogón · Miraflores', rol: 'COCINA_BARRA' }],
      horario: HORARIO_DE_EJEMPLO,
    },
  ],
  'Demo · Cevichería La Marea': [
    {
      nombre: 'Ana Huamán (Cajera)',
      nombreUsuario: 'marea.cajero',
      accesos: [{ sucursal: 'La Marea · Surquillo', rol: 'CAJERO' }],
    },
    {
      nombre: 'Jorge Salas (Mozo)',
      nombreUsuario: 'marea.mozo',
      accesos: [{ sucursal: 'La Marea · Surquillo', rol: 'MOZO' }],
    },
  ],
};

/** Primer Administrador de cada empresa de demostración. */
const ADMINISTRADORES_DE_DEMOSTRACION: Record<string, { nombre: string; nombreUsuario: string }> = {
  'Demo · Restaurante El Fogón': {
    nombre: 'Marta Pérez (Administradora)',
    nombreUsuario: 'fogon.admin',
  },
  'Demo · Cevichería La Marea': {
    nombre: 'Luis Vega (Administrador)',
    nombreUsuario: 'marea.admin',
  },
};

/** Dos empresas de demostración con RUC de ejemplo válidos (dígito verificador correcto). */
const EMPRESAS_DE_DEMOSTRACION: RegistrarEmpresaEntrada[] = [
  {
    nombre: 'Demo · Restaurante El Fogón',
    emisores: [
      { ruc: '20100000009', razonSocial: 'El Fogón Restaurante S.A.C.', regimen: 'GENERAL' },
      { ruc: '10456789019', razonSocial: 'Pérez Quispe, Juan Carlos', regimen: 'NUEVO_RUS' },
    ],
    sucursales: [
      {
        rucEmisor: '20100000009',
        nombre: 'El Fogón · Miraflores',
        codigoEstablecimiento: '0001',
        direccion: 'Av. Larco 345, Miraflores, Lima',
        horario: [
          { dia: 1, desde: '12:00', hasta: '23:00' },
          { dia: 2, desde: '12:00', hasta: '23:00' },
          { dia: 5, desde: '12:00', hasta: '02:00' },
          { dia: 6, desde: '12:00', hasta: '02:00' },
        ],
        whatsapp: '+51987654321',
      },
      {
        rucEmisor: '20100000009',
        nombre: 'El Fogón · San Isidro',
        codigoEstablecimiento: '0002',
        direccion: 'Calle Los Cedros 120, San Isidro, Lima',
        horaCorte: '04:00',
      },
      {
        rucEmisor: '10456789019',
        nombre: 'El Fogón · Kiosco Barranco',
        codigoEstablecimiento: '0001',
        direccion: 'Jr. Unión 88, Barranco, Lima',
      },
    ],
  },
  {
    nombre: 'Demo · Cevichería La Marea',
    emisores: [
      {
        ruc: '20600000005',
        razonSocial: 'La Marea Cevichería E.I.R.L.',
        regimen: 'MYPE_TRIBUTARIO',
      },
    ],
    sucursales: [
      {
        rucEmisor: '20600000005',
        nombre: 'La Marea · Surquillo',
        codigoEstablecimiento: '0001',
        direccion: 'Av. Angamos Este 1500, Surquillo, Lima',
        horario: [{ dia: 3, desde: '11:00', hasta: '17:00' }],
      },
      {
        rucEmisor: '20600000005',
        nombre: 'La Marea · Callao',
        codigoEstablecimiento: '0002',
        direccion: 'Av. Sáenz Peña 410, Callao',
        whatsapp: '+51912345678',
      },
    ],
  },
];

/** Líneas de la tabla de credenciales que imprime la semilla (el PIN solo se conoce al crear al usuario). */
const credenciales: { empresa: string; usuario: string; rol: string; pin: string }[] = [];

async function crearSuperadminDeDemostracion(): Promise<void> {
  const contrasena = process.env.SUPERADMIN_CONTRASENA || SUPERADMIN_CONTRASENA_DEMO;
  try {
    const { id } = await crearSuperadministrador({
      usuario: SUPERADMIN_USUARIO,
      nombre: 'Superadministrador de demostración',
      contrasena,
    });
    console.log(`Creado el superadministrador "${SUPERADMIN_USUARIO}" (${id})`);
  } catch (error) {
    if (!(error instanceof SuperadministradorExistenteError)) throw error;
    console.log(`Ya existe el superadministrador "${SUPERADMIN_USUARIO}"`);
  }
}

async function main() {
  prepararEntornoDeScript();
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'La semilla crea datos y contraseñas públicas de demostración: no se ejecuta con NODE_ENV=production',
    );
  }
  // Sin resolutor por cabecera: la semilla no atiende peticiones.
  delete process.env.EMPRESA_POR_HEADER;
  await crearSuperadminDeDemostracion();

  const app = await crearAplicacion({ logger: ['error', 'warn'] });
  try {
    const plataforma = app.get(PlataformaEmpresasService);
    const contexto = app.get(ContextoEmpresa);
    const usuarios = app.get(UsuariosService);
    const existentes = new Set((await plataforma.listarEmpresas()).map((e) => e.nombre));
    for (const empresa of EMPRESAS_DE_DEMOSTRACION) {
      if (existentes.has(empresa.nombre)) {
        console.log(`Ya existe: ${empresa.nombre}`);
        continue;
      }
      const administrador = ADMINISTRADORES_DE_DEMOSTRACION[empresa.nombre]!;
      const {
        empresaId,
        sucursales,
        administrador: primero,
      } = await plataforma.registrarEmpresa(
        {
          ...empresa,
          administrador: { ...administrador, contrasenaTemporal: CONTRASENA_TEMPORAL_DEMO },
        },
        AUDITORIA,
      );
      console.log(`Creada: ${empresa.nombre} (${empresaId})`);
      credenciales.push({
        empresa: empresa.nombre,
        usuario: administrador.nombreUsuario,
        rol: 'Administrador',
        pin: primero!.pin,
      });
      const sucursalPorNombre = new Map(sucursales.map((s) => [s.nombre, s.id]));
      for (const demo of USUARIOS_DE_DEMOSTRACION[empresa.nombre] ?? []) {
        const creado = await contexto.ejecutar(
          empresaId,
          () =>
            usuarios.crear({
              nombre: demo.nombre,
              nombreUsuario: demo.nombreUsuario,
              esAdministrador: demo.esAdministrador ?? false,
              accesos: (demo.accesos ?? []).map((a) => ({
                sucursalId: sucursalPorNombre.get(a.sucursal)!,
                rol: a.rol,
              })),
              contrasenaTemporal: CONTRASENA_TEMPORAL_DEMO,
              ...(demo.horario === undefined ? {} : { horario: demo.horario }),
            }),
          { actor: { sistema: 'semilla' } },
        );
        credenciales.push({
          empresa: empresa.nombre,
          usuario: demo.nombreUsuario,
          rol: [...new Set((demo.accesos ?? []).map((a) => a.rol))].join(' + ') || 'Administrador',
          pin: creado.pin,
        });
      }
    }
  } finally {
    await app.close();
  }

  if (credenciales.length > 0) {
    console.log(
      '\nUsuarios de demostración (contraseña temporal: se cambia en el primer ingreso):',
    );
    console.log(`  contraseña temporal de todos: ${CONTRASENA_TEMPORAL_DEMO}`);
    for (const c of credenciales) {
      console.log(`  ${c.usuario.padEnd(18)} PIN ${c.pin}  ${c.rol}  (${c.empresa})`);
    }
  }
  console.log(
    `\nSuperadministrador: ${SUPERADMIN_USUARIO} / ${
      process.env.SUPERADMIN_CONTRASENA ? '(SUPERADMIN_CONTRASENA)' : SUPERADMIN_CONTRASENA_DEMO
    }`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
