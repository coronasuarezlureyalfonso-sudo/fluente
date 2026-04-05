export default function handler(req, res) {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    return res.status(500).json({ error: 'Missing environment variables' })
  }

  // Cache 1 hora — las keys no cambian
  res.setHeader('Cache-Control', 's-maxage=3600')
  res.status(200).json({ url, anonKey })
}
