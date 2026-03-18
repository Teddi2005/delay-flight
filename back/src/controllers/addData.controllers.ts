import { Request, Response } from 'express'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { addDataService } from '../service/addData.services'

type AdditionalData = {
  distance: number
  max_temp_f: number
  min_temp_f: number
  avg_temp_f: number
  precip_in: number
  avg_wind_speed_kts: number
  avg_humidity: number
  condition_text: string | null
  aviation: {
    dataSource: 'aviationstack' | 'none'
    matchedFlight: {
      status: string | null
      airline: string | null
      flightNumber: string | null
      scheduledDeparture: string | null
      estimatedDeparture: string | null
      actualDeparture: string | null
      departureDelayMinutes: number | null
    }
  }
}

export const searchAirController = async (req: Request, res: Response) => {
  try {
    const { country, flightDate, flightTime, airline, origin, destination } = req.body

    const additionalData: AdditionalData = await addDataService(country, flightDate, flightTime, airline, origin, destination)

    req.body.FL_DATE = flightDate
    req.body.CRS_DEP_TIME = flightTime
    req.body.DISTANCE = additionalData.distance
    req.body.max_temp_f = additionalData.max_temp_f
    req.body.min_temp_f = additionalData.min_temp_f
    req.body.avg_temp_f = additionalData.avg_temp_f
    req.body.precip_in = additionalData.precip_in
    req.body.avg_wind_speed_kts = additionalData.avg_wind_speed_kts
    req.body.avg_humidity = additionalData.avg_humidity
    req.body.condition_text = additionalData.condition_text
    req.body.OP_CARRIER = additionalData.aviation.matchedFlight.airline || airline
    req.body.ORIGIN = origin
    req.body.DEST = destination

    const prediction = await predictDelay(req.body)
    const analysis = generateAnalysis(prediction, additionalData, req.body)

    res.json({
      message: 'Prediction successful',
      delay: prediction,
      input: req.body,
      analysis
    })
  } catch (error) {
    console.error('Error in searchAirController:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

const monthNameMap = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const toNumber = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, Number(n.toFixed(1))))

const buildMonthlyAvgDelay = (baseDelay: number, month: number) => {
  const seasonBoost = [1.15, 1.1, 1.0, 0.95, 0.92, 1.08, 1.15, 1.2, 1.05, 0.96, 1.0, 1.12]
  const currentBase = Math.max(5, baseDelay)

  return monthNameMap.reduce(
    (acc, m, idx) => {
      const proximity = Math.max(0.9, 1 - Math.abs(idx + 1 - month) * 0.01)
      acc[m] = toNumber(currentBase * seasonBoost[idx] * proximity, 5, 120)
      return acc
    },
    {} as Record<string, number>
  )
}

const buildDelayReasons = (weatherImpact: 'Low' | 'Medium' | 'High', realtimeDelay: number | null) => {
  const weatherWeight = weatherImpact === 'High' ? 40 : weatherImpact === 'Medium' ? 28 : 18
  const atcWeight = realtimeDelay !== null && realtimeDelay >= 30 ? 30 : 24
  const maintenanceWeight = realtimeDelay !== null && realtimeDelay >= 45 ? 22 : 20
  const crewWeight = 10
  const passengerWeight = 10

  const total = weatherWeight + atcWeight + maintenanceWeight + crewWeight + passengerWeight
  const normalize = (v: number) => Math.round((v / total) * 100)

  const reasons = [
    { reason: 'Weather', percentage: normalize(weatherWeight) },
    { reason: 'Air Traffic Control', percentage: normalize(atcWeight) },
    { reason: 'Aircraft Maintenance', percentage: normalize(maintenanceWeight) },
    { reason: 'Crew Issues', percentage: normalize(crewWeight) },
    { reason: 'Passenger Related', percentage: normalize(passengerWeight) }
  ]

  const diff = 100 - reasons.reduce((sum, r) => sum + r.percentage, 0)
  reasons[0].percentage += diff

  return reasons
}

const generateAnalysis = (predictedDelay: number, additionalData: AdditionalData, input: any) => {
  const realtimeDelay = additionalData.aviation.matchedFlight.departureDelayMinutes
  const modelDelay = toNumber(predictedDelay, 0, 180)
  const combinedDelay = realtimeDelay !== null ? modelDelay * 0.6 + realtimeDelay * 0.4 : modelDelay
  const estimatedDelay = toNumber(combinedDelay, 0, 180)

  let riskLevel: 'Low' | 'Medium' | 'High'
  let riskColor: string
  if (estimatedDelay < 15) {
    riskLevel = 'Low'
    riskColor = '#10b981'
  } else if (estimatedDelay < 30) {
    riskLevel = 'Medium'
    riskColor = '#f59e0b'
  } else {
    riskLevel = 'High'
    riskColor = '#ef4444'
  }

  const { precip_in, avg_wind_speed_kts, avg_humidity } = additionalData
  let weatherImpact: 'Low' | 'Medium' | 'High'
  if (precip_in < 0.1 && avg_wind_speed_kts < 10 && avg_humidity < 70) {
    weatherImpact = 'Low'
  } else if (precip_in < 0.5 && avg_wind_speed_kts < 20 && avg_humidity < 85) {
    weatherImpact = 'Medium'
  } else {
    weatherImpact = 'High'
  }

  const distance = additionalData.distance
  const distanceCategory = distance < 500 ? 'Short-haul' : distance < 2000 ? 'Medium-haul' : 'Long-haul'

  const onTimeRate = toNumber(100 - estimatedDelay * 1.4, 35, 97)
  const avgDelay = toNumber(estimatedDelay, 3, 120)
  const delayScore = toNumber(100 - estimatedDelay * 1.2, 5, 98)

  const month = new Date(input.FL_DATE).getMonth() + 1
  let seasonalTrend = 'Normal season'
  if ([6, 7, 8].includes(month)) seasonalTrend = 'Peak season - higher delays expected'
  else if ([12, 1, 2].includes(month)) seasonalTrend = 'Weather-sensitive period'

  const airportCongestion = {
    origin: realtimeDelay !== null && realtimeDelay > 25 ? 'High' : input.ORIGIN === 'HAN' ? 'High' : 'Medium',
    destination: input.DEST === 'SGN' || (realtimeDelay !== null && realtimeDelay > 25) ? 'High' : 'Medium'
  }

  const recommendations: string[] = []
  if (riskLevel === 'High') {
    recommendations.push('Arrive at airport 2 hours earlier than usual')
    recommendations.push('Monitor flight status updates closely')
    recommendations.push('Consider alternative flights')
    recommendations.push('Check weather alerts and airport announcements')
  } else if (riskLevel === 'Medium') {
    recommendations.push('Arrive at airport 30 minutes earlier than usual')
    recommendations.push('Monitor flight status updates')
    recommendations.push('Prepare backup transportation plans')
  } else {
    recommendations.push('Arrive at airport on time')
    recommendations.push('Check flight status before departure')
  }

  const statistics = {
    avgDelay,
    onTimePercentage: onTimeRate,
    delayDistribution:
      riskLevel === 'High'
        ? { '0-15min': 28, '15-30min': 32, '30-60min': 26, '60min+': 14 }
        : riskLevel === 'Medium'
          ? { '0-15min': 45, '15-30min': 35, '30-60min': 15, '60min+': 5 }
          : { '0-15min': 68, '15-30min': 22, '30-60min': 8, '60min+': 2 },
    monthlyAvgDelay: buildMonthlyAvgDelay(avgDelay, month),
    topDelayReasons: buildDelayReasons(weatherImpact, realtimeDelay)
  }

  return {
    riskLevel,
    riskColor,
    weatherImpact,
    distanceCategory,
    delayEstimates: {
      model: modelDelay,
      combined: estimatedDelay,
      realtime: realtimeDelay
    },
    airlinePerformance: {
      onTimeRate,
      avgDelay,
      delayScore,
      cancellationRate: toNumber(Math.max(1.5, avgDelay / 12), 1.5, 12)
    },
    seasonalTrend,
    airportCongestion,
    recommendations,
    statistics,
    operationalData: {
      source: additionalData.aviation.dataSource,
      status: additionalData.aviation.matchedFlight.status,
      flightNumber: additionalData.aviation.matchedFlight.flightNumber,
      realtimeDepartureDelay: realtimeDelay,
      scheduledDeparture: additionalData.aviation.matchedFlight.scheduledDeparture,
      estimatedDeparture: additionalData.aviation.matchedFlight.estimatedDeparture,
      actualDeparture: additionalData.aviation.matchedFlight.actualDeparture,
      confidence: realtimeDelay !== null ? 'High' : 'Medium'
    }
  }
}

const predictDelay = async (data: any): Promise<number> => {
  const candidates = [
    path.resolve(process.cwd(), 'src/models/model.py'),
    path.resolve(process.cwd(), 'src/models/__pycache__/model.cpython-313.pyc'),
    path.resolve(process.cwd(), 'dist/models/model.py'),
    path.resolve(process.cwd(), 'dist/models/__pycache__/model.cpython-313.pyc'),
  ]

  const script = candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[1]
  const pythonProcess = spawn('python', [script, JSON.stringify(data)])
  const timeoutMs = Number(process.env.PYTHON_TIMEOUT_MS || 30000)

  return new Promise((resolve, reject) => {
    let result = ''
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      pythonProcess.kill()
      reject(new Error('Python process timed out'))
    }, timeoutMs)

    const finalizeError = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    }

    pythonProcess.on('error', (error: Error) => {
      finalizeError(error)
    })

    pythonProcess.stdout.on('data', (chunk: Buffer) => {
      result += chunk.toString()
    })

    pythonProcess.stderr.on('data', (chunk: Buffer) => {
      console.error('Python stderr:', chunk.toString())
    })

    pythonProcess.on('close', (code: number) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)

      if (code !== 0) {
        reject(new Error(`Python process exited with code ${code}`))
        return
      }

      try {
        if (!result.trim()) throw new Error('No output from Python script')
        const prediction = parseFloat(result.trim())
        resolve(prediction)
      } catch (e: any) {
        reject(new Error(`Failed to parse prediction: ${e.message}`))
      }
    })
  })
}


