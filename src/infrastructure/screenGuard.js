/**
 * Protección de `POST /screen`: el único endpoint que gasta dinero por llamada.
 *
 * `GET /search` consulta Mongo y su coste marginal es despreciable. `/screen`
 * llama al modelo, así que dejarlo abierto no es un riesgo de disponibilidad
 * sino de presupuesto: nadie tumba el servicio, se agota el saldo.
 *
 * Dos capas, en este orden:
 *  1. Clave de API. Es la protección real.
 *  2. Límite de tasa por clave. Acota el daño si una clave se filtra.
 *
 * Límite conocido del punto 2: el contador vive en memoria del proceso. En
 * Lambda cada instancia lleva el suyo, así que el techo efectivo es
 * `límite × instancias concurrentes`. Sirve para frenar un bucle accidental o
 * un abuso torpe; no sustituye a un límite en el gateway. Si esto pasa a
 * multi-instancia en serio, el contador va a Redis.
 */

const REQUESTS = new Map();

function isScreenAuthEnabled() {
  return Boolean(process.env.SCREEN_API_KEY);
}

/** Ventana y tope, configurables porque el volumen razonable depende del cliente. */
function getLimit() {
  return {
    max: Number(process.env.SCREEN_RATE_LIMIT ?? 30),
    windowMs: Number(process.env.SCREEN_RATE_WINDOW_MS ?? 60_000),
  };
}

/**
 * Ventana deslizante simple por clave.
 * @returns {boolean} true si la petición cabe dentro del límite
 */
function withinRateLimit(key) {
  const { max, windowMs } = getLimit();
  const now = Date.now();
  const cutoff = now - windowMs;

  const hits = (REQUESTS.get(key) || []).filter((t) => t > cutoff);
  if (hits.length >= max) {
    REQUESTS.set(key, hits);
    return false;
  }

  hits.push(now);
  REQUESTS.set(key, hits);
  return true;
}

/**
 * Middleware para `/screen`.
 *
 * Si `SCREEN_API_KEY` no está configurada, no exige clave — el proyecto sigue
 * arrancando en local sin ceremonia. Pero entonces tampoco hay a quién limitar,
 * así que el aviso queda en el log de arranque, no en silencio.
 */
function screenGuard(req, res, next) {
  if (!isScreenAuthEnabled()) {
    return next();
  }

  const sent = req.get('x-api-key');
  if (sent !== process.env.SCREEN_API_KEY) {
    return res.status(401).json({ error: 'Clave de API ausente o inválida' });
  }

  if (!withinRateLimit(sent)) {
    const { max, windowMs } = getLimit();
    return res.status(429).json({
      error: 'Límite de tasa excedido',
      detail: `Máximo ${max} adjudicaciones por ${windowMs / 1000} s`,
    });
  }

  next();
}

/** Para las pruebas: el contador es estado de módulo y hay que poder limpiarlo. */
function resetRateLimit() {
  REQUESTS.clear();
}

module.exports = { screenGuard, isScreenAuthEnabled, resetRateLimit };
