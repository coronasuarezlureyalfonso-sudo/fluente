// api/scan-poliza.js — Vercel Serverless Function

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { imageBase64, mediaType } = req.body || {}
    if (!imageBase64) return res.status(400).json({ error: 'Se requiere imageBase64' })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' })

    // Claude Vision solo acepta estos formatos
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    const finalMediaType = validTypes.includes(mediaType) ? mediaType : 'image/jpeg'

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: finalMediaType, data: imageBase64 }
            },
            {
              type: 'text',
              text: 'Eres un extractor de datos de polizas de seguros mexicanas. Lee esta imagen y responde UNICAMENTE con JSON valido, sin texto extra, sin backticks. Si un campo no esta usa null. Montos como numeros. Fechas YYYY-MM-DD.\n\n{"numero_poliza":null,"aseguradora":null,"ramo":null,"cliente":null,"fecha_inicio":null,"fecha_fin":null,"moneda":"MXN","prima_neta":null,"derechos":null,"impuestos":null,"prima_total":null,"financiado":false,"num_pagos":1,"pago_inicial":null,"pago_subsecuente":null,"frecuencia_pago":"anual","dias_gracia":30,"confianza":0.9}'
            }
          ]
        }]
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Anthropic error:', response.status, errText)
      return res.status(502).json({ error: 'Error Claude ' + response.status, detail: errText.slice(0, 400) })
    }

    const data = await response.json()
    const rawText = (data.content && data.content[0] && data.content[0].text) || ''

    let extracted
    try {
      extracted = JSON.parse(rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim())
    } catch (e) {
      return res.status(422).json({ error: 'No se pudo parsear respuesta', raw: rawText.slice(0, 300) })
    }

    if (!extracted.prima_total) {
      extracted.prima_total = (extracted.prima_neta || 0) + (extracted.derechos || 0) + (extracted.impuestos || 0)
    }
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
