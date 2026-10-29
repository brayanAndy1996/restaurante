# Módulo 8. La app del personal: React, Vite y PWA

## React

### Qué es

**React** es una librería para construir interfaces a partir de **componentes**: piezas reutilizables
de pantalla (un botón, una lista, un formulario) escritas como funciones que devuelven lo que se debe
mostrar. Cuando los datos cambian, React actualiza solo lo necesario en la pantalla.

```tsx
function Saludo({ nombre }: { nombre: string }) {
  return <p>Hola, {nombre}</p>; // esto parece HTML, pero es JSX: JavaScript que describe la pantalla
}
```

### Conceptos que verás

| Concepto      | Qué es                                                                            |
| ------------- | --------------------------------------------------------------------------------- |
| Componente    | Una función que devuelve una parte de la pantalla                                 |
| Props         | Los datos que un componente recibe de quien lo usa                                |
| Estado        | Datos que el componente recuerda y que, al cambiar, redibujan la pantalla         |
| Hook (`use…`) | Funciones especiales de React para estado, efectos, datos: `useState`, `useQuery` |

## Las librerías que acompañan a React aquí

| Librería            | Para qué                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| **TanStack Query**  | Pide datos a la API, los guarda en memoria, los refresca y maneja los estados "cargando" y "error" |
| **React Router**    | Decide qué pantalla mostrar según la dirección (`/carta`, `/plataforma/ingreso`…)                  |
| **Vite**            | El servidor de desarrollo y el empaquetador (abajo)                                                |
| **vite-plugin-pwa** | Convierte la app en PWA (abajo)                                                                    |
| **decimal.js**      | Montos de dinero exactos, sin errores de redondeo                                                  |

Un fragmento real, `apps/app/src/modulos/carta/EstacionesLista.tsx`:

```tsx
const consulta = useQuery({
  // pide la lista de estaciones a la API
  queryKey: CLAVES.estaciones,
  queryFn: ({ signal }) => listarEstaciones(signal),
});

const crear = useMutation({
  // crea una estación
  mutationFn: (nombre: string) => envio.enviar((extra) => crearEstacion(nombre, extra)),
  onSuccess: refrescar, // al terminar, vuelve a pedir la lista
});
```

`envio.enviar` es un detalle importante del proyecto: si no hay internet en ese momento, la acción no
se pierde. Queda como "Pendiente de envío" y sale sola cuando vuelve la conexión, con su clave de
idempotencia para que nunca se duplique.

## Cómo está organizada la app

| Carpeta                     | Qué contiene                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/app/src/modulos/`     | Las pantallas, agrupadas: `acceso`, `administracion`, `carta`, `disponibilidad`, `plataforma` |
| `apps/app/src/componentes/` | Piezas comunes de la app: el marco de la página, la ventana de clave de supervisor            |
| `apps/app/src/lib/`         | Lo que no es pantalla: el cliente de la API (`api.ts`), la sesión, los envíos pendientes      |
| `packages/ui/`              | Componentes y estilos compartidos: `Boton`, `Campo`, `TecladoNumerico`, `Lista`…              |

El diseño visual (colores, tipografía, la "dirección Azulejo") está descrito en `DESIGN.md`, y lo
cuida la skill de diseño Impeccable que usa el rol de frontend.

## Vite

**Vite** cumple dos funciones:

- **En desarrollo** (`pnpm dev`): sirve la app en http://localhost:5173 y la recarga al instante cada
  vez que guardas un archivo.
- **Para publicar** (`pnpm build`): junta y comprime todo en unos pocos archivos estáticos (HTML, CSS y
  JavaScript) listos para subir a un servidor. La integración continua revisa además que la app no
  pese de más (`pnpm --filter @restaurante/app presupuesto`), para que cargue rápido con datos móviles.

Vite solo entrega al navegador las variables del `.env` que empiezan con `VITE_`, como
`VITE_API_URL`. Así los secretos de la API nunca llegan al celular.

## PWA (Progressive Web App)

### Qué es

Una **PWA** es una página web que se comporta como una aplicación: se puede **instalar** en la
pantalla de inicio del celular o la tablet, abre a pantalla completa y carga rápido porque guarda sus
archivos en el equipo.

### Para qué sirve aquí

- Los restaurantes no tienen que descargar nada de una tienda de apps: abren el enlace y la instalan.
- Una sola app funciona en Android, iPhone, tablets y computadoras.
- Un **service worker** (un pequeño programa que el navegador corre en segundo plano) guarda los
  archivos de la app y la actualiza sola cuando hay una versión nueva (`registerType: 'autoUpdate'` en
  `apps/app/vite.config.ts`).

Para instalarse, una PWA exige HTTPS. Por eso, en local desde el celular puedes usarla en el
navegador pero no instalarla; en producción sí se podrá.

## Práctica (10 minutos)

1. Con `pnpm dev` corriendo, abre `packages/ui/src/Boton.tsx` y cambia algún texto o color. Guarda y
   mira la app: se actualiza sola. Deshaz el cambio.
2. En Chrome, `F12` → pestaña **Application** (Aplicación) → **Manifest**: verás el nombre y los íconos
   con que se instala la app.

## Para profundizar

- [Aprende React (documentación oficial, en español)](https://es.react.dev/learn)
- [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview)
- [Guía de Vite](https://vite.dev/guide/)
- [Qué es una PWA (web.dev)](https://web.dev/explore/progressive-web-apps)
