# 1. Acceso y usuarios

## Para qué sirve

En un restaurante, varias personas comparten la misma tablet o celular y entran y salen muchas veces
por turno. Escribir usuario y contraseña cada vez es lento, y compartir una sola cuenta impide saber
quién hizo qué. Por eso el sistema combina:

- **Usuario y contraseña** para el primer ingreso en un equipo, o desde un equipo nuevo.
- **PIN** para el día a día en los equipos del local: 4 o 6 dígitos y estás dentro.
- **Cierre por inactividad**, para que nadie use la sesión de otro si la dejó abierta.
- **Horarios de acceso**, para que un trabajador no pueda entrar fuera de su turno.

Así cada acción queda registrada a nombre de quien la hizo.

## 1.1 Primer ingreso de la administradora

1. Abre http://localhost:5173. Como el equipo aún no recuerda a nadie, verás la pantalla **"Ingresa"**.
2. En "Usuario" escribe `fogon.admin` y en "Contraseña" `Temporal-Demo-1`. Toca **"Ingresar"**.
3. Aparece **"Elige tu contraseña"**, porque la contraseña es temporal. Ejemplo:
   - "Contraseña temporal": `Temporal-Demo-1`
   - "Contraseña nueva": `FogonAdmin2026`
   - "Repite la contraseña nueva": `FogonAdmin2026`
4. Toca **"Guardar contraseña"**.

Reglas de la contraseña: entre 8 y 128 caracteres y distinta de la actual. No exige mayúsculas ni
números, aunque conviene usarlos.

**Qué pasó sin que lo veas:** el equipo ahora **recuerda** a Marta. No hay casilla para marcar; pasa
solo al ingresar con contraseña. La próxima vez le bastará su PIN.

Si eliges una sucursal: como Marta es administradora y El Fogón tiene tres, la app pregunta **"Elige
tu sucursal"**. Elige **"El Fogón · Miraflores"**.

## 1.2 Volver a entrar con PIN

1. Toca la inicial de Marta, arriba a la derecha. Se abre la hoja **"Tu sesión"**.
2. Toca **"Salir"** y vuelve a abrir http://localhost:5173.
3. Ahora aparece **"Escribe tu PIN"**. Escribe el PIN de 6 dígitos que la terminal mostró para
   `fogon.admin`. Se envía solo al completar los dígitos.

**Para qué sirve:** en el local, entrar toma dos segundos.

**Qué pasa si te equivocas:** al 5.º y al 10.º error seguido el PIN se bloquea 5 minutos ("PIN
bloqueado por unos minutos"); al 15.º el equipo deja de recordar a la persona y hay que volver a
entrar con contraseña. Así nadie puede adivinar un PIN probando.

## 1.3 Varias personas en el mismo equipo

En el turno, el mozo usará la misma tablet que la administradora.

1. En la pantalla de PIN, toca **"Ingresar con usuario y contraseña"**.
2. Entra como `fogon.mozo` / `Temporal-Demo-1` y elige su contraseña nueva, por ejemplo `MozoLucia2026`.
3. Sal desde **"Tu sesión" › "Salir"** y vuelve a abrir la app: ahora la pantalla dice **"¿Quién
   eres?"** y muestra a Marta y a Lucía. Debajo: "Este celular recuerda a 2 de 5 personas."
4. Toca a Lucía y escribe su PIN de **4 dígitos** (los mozos y cocina tienen 4; administradores,
   cajeros y supervisores tienen 6).

Para pasar de una persona a otra sin salir, usa **"Tu sesión" › "Cambiar usuario"**.

Un equipo recuerda hasta **5 personas**. Si entra una sexta, olvida a la que lleva más tiempo sin
usarlo.

**Mis equipos:** en "Tu sesión" › **"Mis equipos"** cada persona ve en qué equipos la recuerdan y puede
**"Olvidar"** uno que perdió o ya no usa. Si roban una tablet, se olvida desde otro equipo.

## 1.4 Crear un trabajador nuevo

Ejemplo: contratamos a un mozo de fin de semana.

1. Entra como `fogon.admin` y ve a **Ajustes › Usuarios**. Toca **"Agregar usuario"**.
2. Llena:
   - "Nombre": `Diego Mendoza`
   - "Nombre de usuario": `fogon.diego` (no se puede cambiar después; solo minúsculas, números,
     punto, guion o guion bajo)
   - "Contraseña temporal": toca **"Generar una contraseña"**, o escribe `Bienvenido-2026`
   - "Es administrador": apagado
   - "Rol en cada sucursal": **El Fogón · Miraflores → Mozo**; las demás en "Sin acceso"
3. Enciende **"Limitar horario de acceso"** y agrega tramos:
   - Toca "+" en **Vie**: "Desde" `17:00`, "Hasta" `23:30`. Toca "Agregar tramo".
   - Repite en **Sáb**: `12:00` a `02:00` (el tramo cruza la medianoche y sigue el domingo).
   - Repite en **Dom**: `12:00` a `18:00`.
4. La app avisa: "Su PIN tendrá 4 dígitos. Lo verás una sola vez al crear el usuario." Toca **"Crear
   usuario"**.
5. Aparece **"Usuario creado"** con la contraseña temporal y el **PIN de Diego**. Anótalo o toca
   "Copiar PIN", y luego **"Ya lo anoté"**. No se vuelve a mostrar.

**Para qué sirve el horario:** Diego no podrá ingresar un martes a las 10:00, ni autorizar nada fuera
de su turno. El horario se revisa al ingresar; si ya estaba dentro, su sesión no se corta.

**Prueba:** sal y entra como `fogon.diego` un día u hora fuera de sus tramos. Verás "Estás fuera de tu
horario de acceso".

## 1.5 Otras acciones sobre un usuario

En **Ajustes › Usuarios**, toca **"Ver y editar"** en una persona. En "Acciones":

| Acción                   | Cuándo usarla                                                              |
| ------------------------ | -------------------------------------------------------------------------- |
| "Regenerar PIN"          | La persona olvidó su PIN. Recibe uno nuevo, que también se muestra una vez |
| "Restablecer contraseña" | Olvidó su contraseña. Le das una temporal nueva                            |
| "Desactivar usuario"     | Ya no trabaja aquí. No puede entrar, pero su historial se conserva         |
| "Equipos recordados"     | Ver en qué equipos entra con PIN y "Olvidar" alguno                        |

Si cambias el rol de alguien y con eso cambia el largo de su PIN (por ejemplo, de Mozo a Cajero), el
sistema le genera un PIN nuevo.

## 1.6 Cierre por inactividad

Ve a **Ajustes › Acceso**. Para cada sucursal hay dos valores:

| Campo                                                | Rango   | Por defecto | Ejemplo para Miraflores |
| ---------------------------------------------------- | ------- | ----------- | ----------------------- |
| "Cierre por inactividad (minutos)"                   | 1 a 120 | 5           | `10`                    |
| "Cierre por inactividad de Cocina y Barra (minutos)" | 1 a 720 | 60          | `240`                   |

Toca **"Guardar cambios"**.

**Para qué sirve:** si un mozo deja la tablet en la mesa, a los 10 minutos se cierra y el siguiente
debe poner su PIN. La cocina tiene su propio tiempo porque su pantalla queda encendida todo el
servicio. Treinta segundos antes del cierre aparece "Tu sesión se cerrará en 0:30" con el botón
"Seguir trabajando".

La sesión con contraseña dura siempre 30 minutos sin uso, y ninguna sesión dura más de 12 horas.

## 1.7 Aislamiento entre empresas

Entra como `marea.admin` (en otra ventana privada). Revisa Ajustes, Carta y Salón: no verás nada de El
Fogón, aunque los datos estén en la misma base de datos.

**Para qué sirve:** cada restaurante que alquila el sistema solo ve lo suyo. Es la regla más
importante del sistema y está protegida por la propia base de datos.
