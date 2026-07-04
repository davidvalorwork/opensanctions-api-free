/**
 * Unit tests de las funciones puras del searchService.
 * Cubre el fix de "búsqueda por tokens e insensible a acentos" (commit ddd056d).
 * No requiere Mongo: stub de la collection.
 */
const {
  escapeRegex,
  accentInsensitivePattern,
  buildTokenRegexes,
} = require('../src/application/searchService');

describe('searchService — regex helpers', () => {
  describe('escapeRegex', () => {
    test('escapa meta-caracteres regex', () => {
      // Meta chars que DEBEN escapar: . * + ? ^ $ { } ( ) | [ ] \
      // Para cada uno, el patrón escapado (con anclas ^...$) debe matchear
      // SOLO la cadena literal, no una versión regex-interpretada.
      const cases = [
        'O+Connor',
        '(a|b)',
        '[abc]',
        '.*',
        'a^b',
        'nick.name',
      ];
      for (const input of cases) {
        const anchored = new RegExp(`^${escapeRegex(input)}$`);
        // El literal debe matchear exacto (literalmente con su `+`, `(`, etc).
        expect(anchored.test(input)).toBe(true);
        // Una versión "interpretada" (e.g. 'OConnor' = 'O' + '+Connor' interpretado)
        // NO debe matchear. Si el escape funcionó, el regex es literal.
        // Verificamos que NO matchea una cadena que sería match si NO se hubiera escapado.
        if (input === 'O+Connor') {
          // Sin escapar sería "O" + "+" (1+ O's), matches 'OConnor' (just `OConnor`).
          expect(anchored.test('OConnor')).toBe(false);
        }
        if (input === '.*') {
          // Sin escapar, .* matchea cualquier cosa.
          expect(anchored.test('cualquier cosa')).toBe(false);
        }
        if (input === '(a|b)') {
          // Sin escapar, sería grupo de alternancia: 'a' o 'b'.
          expect(anchored.test('a')).toBe(false);
          expect(anchored.test('b')).toBe(false);
        }
        if (input === '[abc]') {
          // Sin escapar, sería clase de caracteres: 'a' o 'b' o 'c'.
          expect(anchored.test('a')).toBe(false);
          expect(anchored.test('b')).toBe(false);
        }
      }
    });

    test('no escapa caracteres normales (letras, espacios)', () => {
      const anchored = new RegExp(`^${escapeRegex('Nicolas Maduro')}$`);
      expect(anchored.test('Nicolas Maduro')).toBe(true);
      expect(anchored.test('Nicol')).toBe(false);
    });
  });

  describe('accentInsensitivePattern', () => {
    test('mapea cada vocal a su clase con tildes', () => {
      // 'a' en el token → 'a' matchea también 'á' (sin tilde en la query).
      const re = new RegExp(accentInsensitivePattern('a'), 'i');
      expect(re.test('Nicolás')).toBe(true); // 'á' matchea clase [aá...]

      const reE = new RegExp(accentInsensitivePattern('e'), 'i');
      expect(reE.test('Pérez')).toBe(true);

      const reI = new RegExp(accentInsensitivePattern('i'), 'i');
      expect(reI.test('í')).toBe(true);

      const reO = new RegExp(accentInsensitivePattern('o'), 'i');
      expect(reO.test('ó')).toBe(true);

      const reU = new RegExp(accentInsensitivePattern('u'), 'i');
      expect(reU.test('ú')).toBe(true);

      const reN = new RegExp(accentInsensitivePattern('n'), 'i');
      expect(reN.test('ñ')).toBe(true);

      const reC = new RegExp(accentInsensitivePattern('c'), 'i');
      expect(reC.test('ç')).toBe(true);
    });

    test('token con tilde normaliza a letra base', () => {
      // 'á' se normaliza a 'a' y se mapea a la clase [aá...].
      const re = new RegExp(accentInsensitivePattern('á'), 'i');
      // 'Maduro' no contiene 'a' ni 'á' en posición... contiene 'a' en Maduro.
      // Como 'a' está en la clase [aá...], matchea.
      expect(re.test('Maduro')).toBe(true);
      // 'Mariana' contiene 'a'.
      expect(re.test('Mariana')).toBe(true);
    });

    test('case-insensitive default', () => {
      const re = new RegExp(accentInsensitivePattern('a'));
      expect(re.test('A')).toBe(true);
    });
  });

  describe('buildTokenRegexes', () => {
    test('un solo token produce un solo regex', () => {
      const regs = buildTokenRegexes('Nicolás');
      expect(regs).toHaveLength(1);
      expect(regs[0]).toBeInstanceOf(RegExp);
    });

    test('multi-token produce N regex AND-ed', () => {
      const regs = buildTokenRegexes('Nicolas Maduro');
      expect(regs).toHaveLength(2);
    });

    test('strings vacíos / whitespace devuelven []', () => {
      expect(buildTokenRegexes('')).toEqual([]);
      expect(buildTokenRegexes('    ')).toEqual([]);
      expect(buildTokenRegexes('  \t\n  ')).toEqual([]);
    });

    test('queries con acentos matchean versiones con/sin tilde', () => {
      // 'Nicolás' como query normaliza 'á' → clase [aá...] para esa posición.
      // El patrón completo incluye 'N', 'i', 'c', 'o', 'l', '[aá...]', 's'.
      // Matchea textos que contengan esa secuencia letra por letra.
      const regsNico = buildTokenRegexes('Nicolás');
      // Texto CON tilde — matchea directo.
      expect(regsNico[0].test('Nicolás')).toBe(true);
      // Texto SIN tilde — matchea porque la clase incluye 'a' y 'á' ambas.
      expect(regsNico[0].test('Nicolas')).toBe(true);
      // Texto sin 'N' (la primera letra) — NO matchea.
      expect(regsNico[0].test('aria')).toBe(false);
    });

    test('queries multi-token con acentos funcionan', () => {
      const regs = buildTokenRegexes('Pérez López');
      // 'P' + 'é' + 'r' + 'e' + 'z' (con clases para é,e)
      expect(regs).toHaveLength(2);
      // El primer regex (Pérez) debería matchear en una string con 'Pérez'.
      expect(regs[0].test('Pérez')).toBe(true);
      // El segundo (López) debería matchear 'Lopez' y 'López'.
      expect(regs[1].test('Lopez')).toBe(true);
      expect(regs[1].test('López')).toBe(true);
    });
  });
});
