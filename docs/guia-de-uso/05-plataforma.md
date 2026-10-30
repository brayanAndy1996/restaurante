# 5. Plataforma: lo que hace nuestro equipo

## Para qué sirve

La plataforma es el panel de **nuestra empresa** (la que alquila el sistema), no de los restaurantes.
Desde aquí se da de alta a un cliente nuevo, se controla si su suscripción está al día y se entra a su
cuenta para darle soporte, siempre dejando registro.

Entra en http://localhost:5173/plataforma/ingreso con `superadmin` / `Superadmin-Demo-1`. El menú
tiene "Empresas", "Suscripciones" y "Planes".

## 5.1 Dar de alta un restaurante nuevo

Caso: firmamos con **"Pollería Don Pepe"**, que tiene un local en Lince.

En **Empresas**, toca **"Nueva empresa"** y llena:

**Empresa**

- "Nombre de la empresa": `Pollería Don Pepe`

**Emisor 1** (el RUC con el que facturará)

- "RUC": `20123456786`
- "Razón social": `Pollería Don Pepe S.A.C.`
- "Régimen tributario": **MYPE Tributario**

El RUC se valida de verdad: 11 dígitos, empieza con 10, 15, 16, 17 o 20, y su último dígito es un
dígito verificador. Si inventas un número y sale "El RUC no es válido", no es un error de la app: ese
RUC no puede existir. Además, cada RUC pertenece a una sola empresa del sistema.

**Sucursal 1**

- "Nombre de la sucursal": `Don Pepe · Lince`
- "Emisor": el de arriba
- "Código de establecimiento": `0001` (el que SUNAT asignó al local; son 4 dígitos)
- "Dirección": `Av. Arequipa 2450, Lince`
- "WhatsApp": `+51987654321`
- "Plan": **Plan por defecto**
- "Vencimiento": deja el sugerido, un mes desde hoy

**Primer administrador**

- "Nombre": `José Pérez`
- "Nombre de usuario": `donpepe.admin`
- "Contraseña temporal": toca **"Generar una contraseña"**

**Auditoría**

- "Motivo del alta": `Contrato firmado el 30/10/2026, plan base`

Toca **"Registrar empresa"**. La pantalla **"Empresa registrada"** muestra la contraseña temporal y el
**PIN de José** (6 dígitos), que **se muestra una sola vez**. En la vida real se los entregas al cliente
en persona.

**Prueba el aislamiento:** entra en una ventana privada como `donpepe.admin`. Verás una empresa vacía,
sin rastro de El Fogón ni de La Marea.

Desde el detalle de la empresa puedes **"Agregar sucursal"** o **"Agregar emisor"** más adelante. Cada
sucursal nueva nace con su suscripción.

## 5.2 Suscripciones y pagos

**Para qué sirve:** cobramos por sucursal. El sistema sabe hasta cuándo está pagada cada una y la
suspende sola si no paga, sin cortar un turno en curso.

Estados de una suscripción:

| Estado       | Qué significa                                                                       |
| ------------ | ----------------------------------------------------------------------------------- |
| "Activa"     | Está pagada                                                                         |
| "En gracia"  | Pasó el vencimiento, pero aún está dentro de los días de gracia (7 en el plan base) |
| "Suspendida" | Pasaron los días de gracia: no puede abrir caja hasta que pague                     |

**Registrar un pago:** en **Suscripciones**, abre la de `Don Pepe · Lince` y toca **"Registrar
pago"**:

- "Monto (S/)": `150.00`
- "Fecha del pago": hoy
- "Medio de pago": **Yape**
- "Referencia": `Operación 4587213`
- "Vencimiento nuevo": el sugerido, un mes después del actual
- "Motivo": `Pago de noviembre`

Las otras acciones son **"Cambiar plan"** y **"Ajustar vencimiento"** (por ejemplo, para regalar una
semana de prueba).

## 5.3 Planes

En **Planes** está el **"Plan base"**, creado por defecto con todos los módulos. Al abrir un plan ves:

- "Días de gracia" (0 a 60)
- "Precio mensual (S/)", "Comprobantes incluidos al mes" y "Precio por comprobante excedente (S/)"
- "Módulos incluidos": Salón, Cocina y barra, Caja, Facturación electrónica, Pedidos web, Inventario,
  Reportes

**Para qué sirve:** más adelante podremos ofrecer, por ejemplo, un plan sin cocina para un café. Si una
sucursal no tiene el módulo Salón en su plan, sus usuarios no ven el menú Salón.

## 5.4 Entrar a dar soporte

Caso: José llama porque no sabe crear un combo.

1. En **Empresas**, junto a Pollería Don Pepe, toca **"Entrar a dar soporte"**.
2. En **"Soporte en Pollería Don Pepe"**:
   - "Motivo": `El cliente pidió ayuda para crear un combo por teléfono`
   - "Sucursal": `Don Pepe · Lince`
3. Entras como administrador de esa empresa. Arriba aparece el aviso "Soporte en Pollería Don Pepe ·
   superadmin · hasta las HH:MM" con el botón **"Terminar"**.

**Para qué sirve el registro:** queda anotado quién entró, cuándo y por qué, y la empresa lo puede ver.
Todo lo que hagas durante el soporte queda a tu nombre. La sesión dura como máximo 2 horas y se cierra
tras 30 minutos sin uso.
