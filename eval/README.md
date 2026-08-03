# Harness de evaluación

Mide si la adjudicación **decide bien**. Las pruebas unitarias miden si el pipeline
**funciona** — son cosas distintas y las dos hacen falta.

```bash
node eval/run.js                       # todos los casos
node eval/run.js --tag homonym         # una familia
node eval/run.js --model claude-sonnet-5
```

Llama al modelo de verdad y **cuesta dinero**. El coste total y por caso se reportan al final.

---

## Por qué existe

Un sistema de decisión en dominio regulado tiene que poder responder tres preguntas:

1. ¿Cambiar el prompt mejoró o empeoró la precisión?
2. ¿Bajar de Opus a un modelo menor degrada el resultado?
3. ¿El sistema decide igual que hace tres meses?

Sin conjunto etiquetado no se responde ninguna. Y **SR 26-2** (Fed/OCC/FDIC, abril 2026) y el
**Anexo IV de la IN BCB 739/2026** esperan que el sistema se pruebe con regularidad — el segundo
exige opinión conclusiva de un auditor independiente sobre estos controles.

Una corrida reproducible con su salida es lo que se le enseña a ese auditor.

---

## Cómo leer la salida

Los errores no pesan igual y el informe no los promedia. Un *accuracy* del 90% esconde si el
10% restante son molestias o sanciones.

| Severidad | Qué pasó | Qué cuesta |
|---|---|---|
| **CRÍTICO** | Una coincidencia real se descartó | Persona sancionada que pasa el filtro. Hallazgo de examinador |
| **GRAVE** | Coincidencia real degradada a dudosa | Sigue llegando a revisión humana. Malo, no fatal |
| **ruido** | Una no-coincidencia se elevó | Tiempo de analista |
| **Error de ruta** | La regla decidió lo que debía decidir el modelo, o al revés | **El peor callado**: si la regla descarta algo, el modelo nunca tuvo oportunidad de acertar |

**El harness solo falla (exit 1) por críticos y errores de ruta.** El ruido se reporta pero no
tumba la corrida: en AML el error caro es el que deja pasar, no el que molesta.

---

## El caso que más importa vigilar

`nationality-01` — nombre y fecha idénticos, nacionalidad distinta.

La doble nacionalidad es común en el perfil de persona que aparece en listas de sanciones. Si
el sistema aprende a descartar por nacionalidad, produce falsos negativos silenciosos y nadie se
entera hasta el examen.

Está marcado `false-negative-risk` a propósito.

---

## Agregar casos

```json
{
  "id": "identificador-corto",
  "tags": ["familia", "otra-familia"],
  "note": "por qué este caso es difícil — se imprime cuando falla",
  "subject": { "name": "...", "birthDate": "...", "nationality": "..." },
  "candidate": {
    "id": "...",
    "caption": "...",
    "properties": { "name": ["..."], "birthDate": ["..."], "nationality": ["..."] }
  },
  "expected": "likely_match | possible_match | unlikely_match",
  "expected_decided_by": "rule | model",
  "needs_review": true
}
```

`expected_decided_by` es opcional y sirve para fijar por dónde debe ir la decisión. Úsalo cuando
el punto del caso sea la ruta, no el veredicto — por ejemplo, comprobar que la tolerancia de ±1
año **no** descarta por regla.

---

## ⚠️ Sobre `needs_review`

Los casos con `needs_review: true` llevan una etiqueta **propuesta, no confirmada.** El harness
lo avisa al final de cada corrida.

Un conjunto de evaluación cuyas etiquetas no revisó un humano con criterio de dominio no mide la
calidad del sistema: mide su parecido con quien escribió las etiquetas. Confirmarlas es trabajo
de analista, no de ingeniero.

**Hasta que se revisen, los números de este harness son indicativos, no evidencia.**

---

## Qué falta

- Casos adversariales de inyección de prompt desde el campo `name` — el adversario controla ese
  campo por diseño
- Más volumen: 12 casos detectan roturas grandes, no regresiones sutiles. El objetivo son 50-100
- Comparación entre modelos en una sola corrida, para decidir el ruteo por dificultad con datos
