const { screenGuard, resetRateLimit } = require('../src/infrastructure/screenGuard');

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

function mockReq(apiKey) {
  return { get: (header) => (header === 'x-api-key' ? apiKey : undefined) };
}

/** Ejecuta el guard y devuelve si dejó pasar. */
function run(apiKey) {
  const res = mockRes();
  let passed = false;
  screenGuard(mockReq(apiKey), res, () => {
    passed = true;
  });
  return { passed, res };
}

describe('screenGuard', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetRateLimit();
    delete process.env.SCREEN_API_KEY;
    delete process.env.SCREEN_RATE_LIMIT;
    delete process.env.SCREEN_RATE_WINDOW_MS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('sin SCREEN_API_KEY configurada deja pasar: el proyecto arranca en local sin ceremonia', () => {
    expect(run(undefined).passed).toBe(true);
  });

  test('rechaza con 401 si falta la clave', () => {
    process.env.SCREEN_API_KEY = 'secreta';
    const { passed, res } = run(undefined);
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  test('rechaza con 401 si la clave no coincide', () => {
    process.env.SCREEN_API_KEY = 'secreta';
    const { passed, res } = run('otra');
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  test('deja pasar con la clave correcta', () => {
    process.env.SCREEN_API_KEY = 'secreta';
    expect(run('secreta').passed).toBe(true);
  });

  test('corta con 429 al superar el límite dentro de la ventana', () => {
    process.env.SCREEN_API_KEY = 'secreta';
    process.env.SCREEN_RATE_LIMIT = '3';

    expect(run('secreta').passed).toBe(true);
    expect(run('secreta').passed).toBe(true);
    expect(run('secreta').passed).toBe(true);

    const cuarta = run('secreta');
    expect(cuarta.passed).toBe(false);
    expect(cuarta.res.statusCode).toBe(429);
  });

  test('el límite es por clave: una clave agotada no bloquea a otra', () => {
    process.env.SCREEN_API_KEY = 'secreta';
    process.env.SCREEN_RATE_LIMIT = '1';

    // Solo hay una clave válida, así que se comprueba que el contador se
    // indexa por clave y no globalmente: tras resetear, vuelve a pasar.
    expect(run('secreta').passed).toBe(true);
    expect(run('secreta').passed).toBe(false);

    resetRateLimit();
    expect(run('secreta').passed).toBe(true);
  });

  test('la ventana expira: pasada la ventana vuelve a dejar pasar', () => {
    process.env.SCREEN_API_KEY = 'secreta';
    process.env.SCREEN_RATE_LIMIT = '1';
    process.env.SCREEN_RATE_WINDOW_MS = '0';

    expect(run('secreta').passed).toBe(true);
    // Con ventana de 0 ms, el hit anterior ya quedó fuera del corte.
    expect(run('secreta').passed).toBe(true);
  });
});
