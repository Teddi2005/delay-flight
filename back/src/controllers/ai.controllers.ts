import { Request, Response } from 'express'
import { chatWithDeepSeek } from '../service/ai.services'

export const aiChatController = async (req: Request, res: Response) => {
  try {
    const { message, context } = req.body
    const reply = await chatWithDeepSeek(message, context)

    res.json({
      reply
    })
  } catch (error: any) {
    console.error('Error in aiChatController:', error)
    res.status(500).json({ error: error?.message || 'AI service error' })
  }
}
