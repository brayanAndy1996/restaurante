# Módulo 7. Código compartido: reglas de negocio y contratos

La app y la API son programas distintos, pero deben estar de acuerdo en dos cosas: **las reglas del
negocio** (cómo se valida un RUC, qué permisos tiene cada rol) y **la forma de los datos** que se
envían entre ellas. Para eso existen dos paquetes compartidos.

## `packages/dominio`: las reglas de negocio puras

### Qué es

Funciones que solo calculan o deciden, sin tocar la base de datos ni la pantalla. Por eso se llaman
"puras": con los mismos datos de entrada, siempre dan el mismo resultado.

| Archivo                       | Qué decide                                                    |
| ----------------------------- | ------------------------------------------------------------- |
| `src/ruc.ts`                  | Si un RUC es válido (dígito verificador)                      |
| `src/dia-operativo.ts`        | A qué día operativo pertenece una hora (corte de las 5 a. m.) |
| `src/horario.ts`              | Si alguien está dentro de su horario de acceso                |
| `src/permisos.ts`             | Qué permisos tiene cada rol                                   |
| `src/carta/precios.ts`        | El precio de un producto según la sucursal                    |
| `src/carta/disponibilidad.ts` | Si un producto está disponible o agotado                      |

### Para qué sirve

- La app puede avisar de un error **antes** de enviar el formulario (por ejemplo, "RUC inválido"), y
  la API vuelve a comprobarlo con **la misma función**. Nunca pueden discrepar.
- Son fáciles de probar: no necesitan base de datos ni navegador. Cuando llegue el cálculo de montos
  (IGV, división de cuenta), vivirá aquí.

## `packages/contratos`: la forma de los datos, con zod

### Qué es zod

**zod** es una librería para describir la forma que deben tener unos datos y comprobarla mientras el
programa corre. TypeScript (módulo 4) revisa los tipos cuando compilas, pero no puede revisar los
datos que llegan de afuera, como el cuerpo de una petición o una respuesta de la API. zod sí.

Un contrato real, `packages/contratos/src/salud.ts`:

```ts
export const saludRespuestaSchema = z.object({
  estado: z.enum(['ok', 'error']), // solo puede ser "ok" o "error"
  baseDeDatos: z.enum(['ok', 'error']),
});

export type SaludRespuesta = z.infer<typeof saludRespuestaSchema>; // el tipo sale del esquema
```

Con un solo esquema se obtiene a la vez la validación y el tipo de TypeScript.

### Cómo se usa

- **En la API:** `PipeZod` valida cada cuerpo que llega. Si no cumple el esquema, responde `400` con
  los campos que fallaron, antes de que el código toque la base.
- **En la app:** `apps/app/src/lib/api.ts` valida cada respuesta de la API con su esquema. Si la API
  cambiara la forma de una respuesta sin avisar, la app lo detecta.

## Práctica (5 minutos)

1. Abre `packages/contratos/src/carta.ts` y busca `estacionEntradaSchema`: ahí está qué datos acepta la
   API para crear una estación y con qué límites.
2. Busca dónde se usa `validarRuc` con la búsqueda de tu editor (`Ctrl + Shift + F`): aparece en
   `packages/dominio`, en `packages/contratos` y en el formulario de empresa de la app.

## Para profundizar

- [Documentación de zod](https://zod.dev/)
