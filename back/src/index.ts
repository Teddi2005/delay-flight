import path from 'path'
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'

// Load .env relative to this file so it works from both src and dist
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const app = express()
const port = Number(process.env.PORT || 3000)

app.use(express.json())

// Enable CORS
const corsOrigin = process.env.CORS_ORIGIN || '*'
const corsOrigins = corsOrigin.split(',').map((origin) => origin.trim()).filter(Boolean)
const corsOptions = corsOrigins.includes('*') ? { origin: '*' } : { origin: corsOrigins, credentials: true }

app.use(cors(corsOptions))

// Import routes
import routes from './routes/routes'
app.use(routes)

app.get('/', (req, res) => {
  res.send('hello world')
})

app.listen(port, () => {
  console.log(`Project này đang chạy trên port ${port}`)
})
