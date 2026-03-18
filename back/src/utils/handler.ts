import { Request, RequestHandler, Response } from 'express'
import { NextFunction } from 'express-serve-static-core'

//hàm nhận vào controller || hoặc middlware áync
//và biến chúng nó thành controller và middleware có cấu trúc try catch next

export const wrapAsync = (func: RequestHandler) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await func(req, res, next) // chạyn hàm của em đã đưa trong cấu trúc
    } catch (error) {
      next(error)
    }
  }
}
