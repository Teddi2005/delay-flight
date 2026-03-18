import { NextFunction, Request, Response } from 'express'
import { body, validationResult } from 'express-validator'

export const aiChatValidator = [
  body('message').isString().notEmpty().withMessage('Message is required'),
  body('context').optional().custom((value) => typeof value === 'object' && value !== null),
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() })
    }
    next()
  }
]
