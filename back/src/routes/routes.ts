import express from 'express'
import { wrapAsync } from '../utils/handler'
import { searchAirController } from '../controllers/addData.controllers'
import { aiChatController } from '../controllers/ai.controllers'
import { informationAirValidator } from '../middlewares/airs.middleware'
import { aiChatValidator } from '../middlewares/ai.middleware'

const routes = express.Router()

/*
    path: /datas/search
    method: POST
    body: {
        country: string,
        flightDate: string,
        flightTime: string,
        airline: string,
        origin: string,
        destination: string
    }
*/

routes.post('/datas/search', informationAirValidator, wrapAsync(searchAirController))

/*
    path: /ai/chat
    method: POST
    body: {
        message: string,
        context: object
    }
*/

routes.post('/ai/chat', aiChatValidator, wrapAsync(aiChatController))

export default routes
