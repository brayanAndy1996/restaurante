// Configuración de ESLint de la API: extiende la base compartida.
// Las reglas del criterio 37 (importar la conexión de plataforma fuera de su módulo y escribir
// `app.empresa_id` fuera del servicio de contexto) se agregan en la tarea T16.
const base = require('@restaurante/config/eslint');

module.exports = [...base];
