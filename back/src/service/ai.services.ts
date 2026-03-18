import axios from 'axios'

type DeepSeekMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

const buildMessages = (message: string, context: unknown): DeepSeekMessage[] => {
  const safeContext = context ? JSON.stringify(context, null, 2) : '{}'

  return [
    {
      role: 'system',
      content:
        'You are an AI assistant for a flight delay dashboard. Reply in Vietnamese. Keep answers short (1-6 lines), plain text only (no Markdown, no bullets, no **). Use line breaks between points. Do not repeat or quote the provided JSON or any user-provided summary; answer only the question.'
    },
    {
      role: 'system',
      content: `Dashboard JSON (context only, do not restate):\n${safeContext}`
    },
    {
      role: 'user',
      content: message
    }
  ]
}

export const chatWithDeepSeek = async (message: string, context: unknown) => {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('Missing DEEPSEEK_API_KEY')
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '')
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  const url = `${baseUrl}/chat/completions`

  let response
  try {
    response = await axios.post<DeepSeekResponse>(
      url,
      {
        model,
        messages: buildMessages(message, context),
        stream: false,
        temperature: 0.4,
        max_tokens: 900
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    )
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      const apiMessage =
        error.response?.data?.error?.message ||
        error.response?.data?.message ||
        error.message ||
        'Unknown DeepSeek error'
      throw new Error(`DeepSeek API error${status ? ` (${status})` : ''}: ${apiMessage}`)
    }
    throw error
  }

  const reply = response.data?.choices?.[0]?.message?.content
  if (!reply) {
    throw new Error('Empty response from DeepSeek')
  }

  return reply.trim()
}
