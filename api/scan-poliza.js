// api/scan-poliza.js
// Vercel Serverless Function — Escaneo de carátula con Claude Vision

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { imageBase64, mediaType } = req.body || {}

    if (!imageBase64) {
      return res.status(400).json({ error: 'Se requiere imageBase64' })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' })
    }

    const SYSTEM_PROMPT = `Eres un extractor experto de datos de polizas de seguros mexicanas.
Lee la caratula y extrae datos estructurados.
Responde UNICAMENTE con un objeto JSON valido, sin texto adicional, sin backticks.
Si un campo no esta presente, usa null.
Montos como numeros sin simbolos ni comas. Fechas en formato YYYY-MM-DD.`

    const USER_PROMPT = `Extrae los datos de esta caratula de poliza y devuelve este JSON exacto:
{
  "numero_poliza": null,
  "aseguradora": null,
  "ramo": null,
  "cliente": null,
  "fecha_inicio": null,
  "fecha_fin": null,
  "moneda": "MXN",
  "prima_neta": null,
  "derechos": null,
  "impuestos": null,
  "prima_total": null,
  "financiado": false,
  "num_pagos": 1,
  "pago_inicial": null,
  "pago_subsecuente": null,
  "frecuencia_pago": "anual",
  "dias_gracia": 30,
  "confianza": 0.9
}`

    // Determinar el tipo de media correcto
    const finalMediaType = (mediaType && mediaType.startsWith('image/'))
      ? mediaType
      : 'image/jpeg'

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: finalMediaType,
                data: imageBase64
              }
            },
            {
              type: 'text',
              text: USER_PROMPT
            }
          ]
        }]
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Anthropic error:', response.status, errText)
      return res.status(502).json({
        error: 'Error en API de Claude: ' + response.status,
        detail: errText.slice(0, 200)
      })
    }

    const data = await response.json()
    const rawText = (data.content && data.content[0] && data.content[0].text) || ''

    let extracted
    try {
      const clean = rawText
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim()
      extracted = JSON.parse(clean)
    } catch (e) {
      console.error('Parse error:', e.message, 'Raw:', rawText.slice(0, 200))
      return res.status(422).json({
        error: 'No se pudo parsear la respuesta de IA',
        raw: rawText.slice(0, 500)
      })
    }

    // Calcular prima_total si no viene
    if (!extracted.prima_total) {
      extracted.prima_total =
        (extracted.prima_neta  || 0) +
        (extracted.derechos    || 0) +
        (extracted.impuestos   || 0)
    }

    // Estimar IVA si solo hay prima_neta
    if (extracted.prima_neta && !extracted.impuestos) {
      extracted.impuestos   = Math.round(extracted.prima_neta * 0.16 * 100) / 100
      extracted.prima_total = extracted.prima_neta + (extracted.derechos || 0) + extracted.impuestos
    }

    return res.status(200).json({ ok: true, data: extracted })

  } catch (err) {
    console.error('scan-poliza error:', err)
    return res.status(500).json({ error: err.message || 'Error interno' })
  }
}
