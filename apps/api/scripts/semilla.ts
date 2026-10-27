// pnpm db:semilla  ->  dos empresas de demostración. Idempotente: si una ya existe (mismo nombre), no hace nada.
// Usa la vía de plataforma (PlataformaEmpresasService) con el actor `semilla`, así que deja su
// fila en `auditoria` (origen plataforma, actor de sistema `semilla`, que también es el actor de trazabilidad). Toma DATABASE_URL y DATABASE_PLATAFORMA_URL del entorno o del .env;
// si faltan, las deriva de DATABASE_ADMIN_URL (roles de la aplicación, base `restaurante`).
import 'reflect-metadata';
import type { RegistrarEmpresaEntrada } from '@restaurante/contratos';
import { crearAplicacion } from '../src/aplicacion';
import { cargarEnvDeLaRaiz } from '../src/config/cargar-env';
import { PlataformaEmpresasService } from '../src/modulos/plataforma';
import { BASE_DE_DATOS_POR_DEFECTO, urlParaRol } from './lib/roles';

const AUDITORIA = { actor: 'semilla', motivo: 'Datos de demostración (pnpm db:semilla)' };

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

function completarEntorno(): void {
  const admin = process.env.DATABASE_ADMIN_URL;
  if (!admin) return;
  process.env.DATABASE_URL ??= urlParaRol(admin, 'api', BASE_DE_DATOS_POR_DEFECTO);
  process.env.DATABASE_PLATAFORMA_URL ??= urlParaRol(
    admin,
    'plataforma',
    BASE_DE_DATOS_POR_DEFECTO,
  );
}

async function main() {
  cargarEnvDeLaRaiz();
  completarEntorno();
  // Sin resolutor por cabecera: la semilla no atiende peticiones.
  delete process.env.EMPRESA_POR_HEADER;
  const app = await crearAplicacion({ logger: ['error', 'warn'] });
  try {
    const plataforma = app.get(PlataformaEmpresasService);
    const existentes = new Set((await plataforma.listarEmpresas()).map((e) => e.nombre));
    for (const empresa of EMPRESAS_DE_DEMOSTRACION) {
      if (existentes.has(empresa.nombre)) {
        console.log(`Ya existe: ${empresa.nombre}`);
        continue;
      }
      const { empresaId } = await plataforma.registrarEmpresa(empresa, AUDITORIA);
      console.log(`Creada: ${empresa.nombre} (${empresaId})`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
