# Guía de uso con ejemplos: El Fogón, de cero a la primera mesa cobrada

Esta guía recorre todo lo que hoy existe en `main` (plataforma y acceso, carta, salón y cocina, e
impresión), con datos concretos para escribir y con la explicación de **para qué sirve** cada cosa en
un restaurante real.

Es más detallada que el recorrido de `DESPLIEGUE-LOCAL.md`, sección 5. Antes de empezar, el sistema
tiene que estar corriendo en tu computadora (ver `docs/aprendizaje/00-levantar-el-proyecto.md`).

## El caso de ejemplo

Usaremos la empresa de demostración **"Demo · Restaurante El Fogón"**, sucursal **"El Fogón ·
Miraflores"**. Vamos a dejarla lista para atender: personal, carta con modificadores y combos, mapa de
mesas, cocina e impresión. Al final atenderemos la mesa 4 de principio a fin.

## Orden recomendado

| Paso | Archivo                                            | Qué haces                                                         | Tiempo |
| ---- | -------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| 1    | [01-acceso-y-usuarios.md](01-acceso-y-usuarios.md) | Primer ingreso, PIN, equipos recordados, crear personal, horarios | 20 min |
| 2    | [02-carta.md](02-carta.md)                         | Estaciones, familias, productos, modificadores, combos, menú      | 40 min |
| 3    | [03-salon-y-cocina.md](03-salon-y-cocina.md)       | Mapa de mesas y una atención completa con la cocina               | 30 min |
| 4    | [04-impresion.md](04-impresion.md)                 | Impresoras, destinos y el simulador de puente                     | 20 min |
| 5    | [05-plataforma.md](05-plataforma.md)               | Lo que hace nuestro equipo: empresas, suscripciones y soporte     | 15 min |

Los pasos 3 y 4 necesitan la carta del paso 2: la base de datos empieza **sin carta, sin mesas y sin
impresoras**.

## Datos de demostración que ya existen

Los crea `pnpm local:preparar`. Todos los usuarios empiezan con la contraseña temporal
`Temporal-Demo-1`. Los PIN se imprimieron en la terminal al final de ese comando: tenlos a mano.

| Usuario            | Persona      | Rol                                     | Sucursales              |
| ------------------ | ------------ | --------------------------------------- | ----------------------- |
| `fogon.admin`      | Marta Pérez  | Administrador                           | Todas las de El Fogón   |
| `fogon.supervisor` | Rosa Quispe  | Supervisor                              | Miraflores              |
| `fogon.cajero`     | Carlos Ramos | Cajero                                  | Miraflores              |
| `fogon.mozo`       | Lucía Torres | Mozo                                    | Miraflores y San Isidro |
| `fogon.cocina`     | Pedro Flores | Cocina/Barra, con horario 11:00 a 23:00 | Miraflores              |
| `marea.admin`      | Luis Vega    | Administrador                           | Las de La Marea         |
| `marea.cajero`     | Ana Huamán   | Cajero                                  | La Marea · Surquillo    |
| `marea.mozo`       | Jorge Salas  | Mozo                                    | La Marea · Surquillo    |

Sucursales de El Fogón: "El Fogón · Miraflores", "El Fogón · San Isidro" y "El Fogón · Kiosco
Barranco" (esta última con un RUC del Nuevo RUS). El superadministrador es `superadmin` con la
contraseña `Superadmin-Demo-1`.

## Qué ve cada rol en el menú

| Rol           | Menú                                           |
| ------------- | ---------------------------------------------- |
| Mozo          | Salón                                          |
| Cajero        | Salón y Carta                                  |
| Cocina/Barra  | Cocina y Disponibilidad                        |
| Supervisor    | Salón, Cocina y Disponibilidad                 |
| Administrador | Salón, Cocina, Carta, Disponibilidad y Ajustes |

## Consejos para practicar

- La app está pensada para celular. En Chrome, `F12` y luego `Ctrl + Shift + M` la muestra en tamaño
  de celular.
- Para ver a dos personas a la vez (el mozo y la cocina, por ejemplo), abre una **ventana privada**
  (`Ctrl + Shift + N`) o otro navegador: cada ventana tiene su propia sesión.
- `fogon.cocina` solo puede ingresar de 11:00 a 23:00, hora de Lima. Fuera de ese horario usa
  `fogon.supervisor` o `fogon.admin` para ver la cocina.
- Si quieres empezar de cero: `docker compose down -v` y `pnpm local:preparar`.
