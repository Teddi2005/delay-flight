import { NextFunction, Request, Response } from 'express'
import { body, validationResult } from 'express-validator'

export const informationAirValidator = [
  body('country').isString().notEmpty().withMessage('Country is required'),
  body('flightDate').isISO8601().withMessage('Flight date must be in ISO 8601 format'),
  body('flightTime').isString().notEmpty().withMessage('Flight time is required'),
  body('airline').isString().notEmpty().withMessage('Airline is required'),
  body('origin').isString().notEmpty().withMessage('Origin is required'),
  body('destination').isString().notEmpty().withMessage('Destination is required'),
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() })
    }
    next()
  }
]
