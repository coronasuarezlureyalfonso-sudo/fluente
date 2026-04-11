// api/scan-poliza.js
// Vercel Serverless Function — Escaneo de carátula con Claude Vision
// Costo estimado: ~$0.004 USD por escaneo
//
// Deploy: este archivo va en /api/scan-poliza.js en tu repo de GitHub
// Variables de entorno necesarias en Vercel:
//   ANTHROPIC_API_KEY   — tu key de console.anthropic.com
//   SUPABASE_URL        — https://okjbadvvnegtelgjmsfy.supabase.co
//   SUPABASE_ANON_KEY   — tu anon key

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } }

const SYSTEM_PROMPT = `Eres un extractor experto de datos de pólizas de seguros mexicanas.
Tu trabajo es leer carátulas de pólizas (PDFs convertidos a imagen) y extraer datos estructurados.
Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin backticks, sin explicaciones.
Si un campo no está presente en el documento, usa null.
Todos los montos deben ser números (sin símbolos de moneda ni comas).
Las fechas deben estar en formato YYYY-MM-DD.`

const EXTRACTION_PROMPT = `Extrae todos los datos de esta carátula de póliza de seguro y devuélvelos en este formato JSON exacto:

{
  "numero_poliza": "string o null",
  "aseguradora": "string o null",
  "ramo": "Auto | Gastos Médicos | Vida | Empresarial | Daños | Viajero | RC | otro",
  "cliente": "nombre completo del asegurado o null",
  "fecha_inicio": "YYYY-MM-DD o null",
  "fecha_fin": "YYYY-MM-DD o null",
  "moneda": "MXN | USD | null",
  "prima_neta": número o null,
  "derechos": número o null,
  "impuestos": número o null,
  "prima_total": número o null,
  "financiado": true | false,
  "num_pagos": número entero (1=contado, 2/4/6/12=parcialidades) o null,
  "pago_inicial": número o null,
  "pago_subsecuente": número o null,
  "frecuencia_pago": "anual | semestral | trimestral | mensual | null",
  "dias_gracia": número entero o null,
  "vehiculo_marca": "string o null",
  "vehiculo_modelo": "string o null",
  "vehiculo_anio": número o null,
  "vehiculo_placas": "string o null",
  "vehiculo_serie": "string o null",
  "suma_asegurada": número o null,
  "confianza": número entre 0 y 1 indicando tu confianza en la extracción
}`

export default async function handler(req, res) {
  // Solo POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // CORS para tu dominio
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  try {
    const { imageBase64, mediaType } = req.body

    if (!imageBase64) {
      return res.status(400).json({ error: 'Se requiere imageBase64' })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada en Vercel' })
    }

    // Llamada a Claude claude-sonnet-4-20250514 con visión
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType || 'image/jpeg',
                data: imageBase64
              }
            },
            {
              type: 'text',
              text: EXTRACTION_PROMPT
            }
          ]
        }]
      })
    })

    if (!response.ok) {
      const errBody = await response.text()
      console.error('Anthropic API error:', response.status, errBody)
      return res.status(502).json({
        error: 'Error en API de Claude',
        detail: errBody
      })
    }

    const data = await response.json()
    const rawText = data.content?.[0]?.text || ''

    // Parsear JSON de la respuesta
    let extracted
    try {
      // Limpiar por si Claude devuelve backticks o texto extra
      const clean = rawText
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim()
      extracted = JSON.parse(clean)
    } catch (parseErr) {
      console.error('Parse error:', parseErr, 'Raw:', rawText)
      return res.status(422).json({
        error: 'No se pudo parsear la respuesta de IA',
        raw: rawText
      })
    }

    // Calcular prima_total si no viene explícita
    if (!extracted.prima_total && (extracted.prima_neta || extracted.derechos || extracted.impuestos)) {
      extracted.prima_total =
        (extracted.prima_neta   || 0) +
        (extracted.derechos     || 0) +
        (extracted.impuestos    || 0)
    }

    // Estimar impuestos si solo viene prima_neta (IVA 16%)
    if (extracted.prima_neta && !extracted.impuestos && !extracted.prima_total) {
      extracted.impuestos   = Math.round(extracted.prima_neta * 0.16 * 100) / 100
      extracted.prima_total = extracted.prima_neta + (extracted.derechos || 0) + extracted.impuestos
    }

    return res.status(200).json({
      ok: true,
      data: extracted,
      tokens_used: data.usage?.input_tokens + data.usage?.output_tokens || 0,
      cost_usd: ((data.usage?.input_tokens || 0) * 0.000003 + (data.usage?.output_tokens || 0) * 0.000015).toFixed(5)
    })

  } catch (err) {
    console.error('scan-poliza error:', err)
    return res.status(500).json({ error: 'Error interno del servidor', detail: err.message })
  }
}
