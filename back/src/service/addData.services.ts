import axios from 'axios'

// Database sân bay v?i t?a d? (latitude, longitude)
const airportCoordinates: { [key: string]: { lat: number; lon: number } } = {
  SGN: { lat: 10.8191, lon: 106.6513 }, // Ho Chi Minh City
  HAN: { lat: 21.2214, lon: 105.7975 }, // Hanoi
  DAD: { lat: 16.0544, lon: 108.2007 }, // Da Nang
  CTS: { lat: 8.3639, lon: 104.6763 }, // Can Tho
  PQC: { lat: 9.7733, lon: 107.0393 }, // Phu Quoc
  VCA: { lat: 12.2186, lon: 109.2001 }, // Ca Mau
  DLI: { lat: 13.9875, lon: 109.3045 }, // Lien Khuong (Da Lat)
  BBS: { lat: 14.8694, lon: 108.0197 }, // Ba To (Ba To Airport)
  PHA: { lat: 15.7231, lon: 108.7373 }, // Pleiku
  // Thêm các sân bay qu?c t? khác
  BKK: { lat: 13.69, lon: 100.7501 }, // Bangkok
  SIN: { lat: 1.3521, lon: 103.8198 }, // Singapore
  HKG: { lat: 22.3193, lon: 114.1694 }, // Hong Kong
  TPE: { lat: 25.033, lon: 121.5645 }, // Taipei
  ICN: { lat: 37.4603, lon: 126.4407 }, // Seoul
  NRT: { lat: 35.7653, lon: 140.3931 }, // Tokyo
  PVG: { lat: 31.1443, lon: 121.805 }, // Shanghai
  CTU: { lat: 30.5728, lon: 104.0668 }, // Chengdu
  CAN: { lat: 23.3898, lon: 113.3089 }, // Guangzhou
  PEK: { lat: 40.0801, lon: 116.5847 } // Beijing
}

type AviationFlight = {
  flight_status?: string
  flight_date?: string
  departure?: {
    iata?: string
    scheduled?: string
    estimated?: string
    actual?: string
    delay?: number
  }
  arrival?: {
    iata?: string
    scheduled?: string
    estimated?: string
    actual?: string
    delay?: number
  }
  airline?: {
    name?: string
    iata?: string
  }
  flight?: {
    iata?: string
    number?: string
  }
}

type MatchedFlightInfo = {
  status: string | null
  airline: string | null
  flightNumber: string | null
  scheduledDeparture: string | null
  estimatedDeparture: string | null
  actualDeparture: string | null
  departureDelayMinutes: number | null
}

/**
 * Tính kho?ng cách gi?a 2 di?m d?a trên công th?c Haversine
 * @returns Kho?ng cách tính b?ng miles
 */
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371 // Bán kính Trái Đ?t (km)
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distance = R * c // km

  return distance * 0.621371
}

/**
 * L?y kho?ng cách gi?a hai sân bay
 */
const getAirportDistance = (origin: string, destination: string): number => {
  const originCode = origin.toUpperCase()
  const destCode = destination.toUpperCase()

  if (airportCoordinates[originCode] && airportCoordinates[destCode]) {
    const originCoord = airportCoordinates[originCode]
    const destCoord = airportCoordinates[destCode]

    return calculateDistance(originCoord.lat, originCoord.lon, destCoord.lat, destCoord.lon)
  }

  console.warn(`Airport not found in database: ${originCode} or ${destCode}`)
  return 500
}

const getWeatherByAirportCode = async (origin: string) => {
  const key = process.env.WEATHER_API_KEY
  if (!key) {
    throw new Error('Missing WEATHER_API_KEY')
  }

  const originCode = origin.toUpperCase()
  const coord = airportCoordinates[originCode]
  const q = coord ? `${coord.lat},${coord.lon}` : originCode

  const weatherResponse = await axios.get(
    `https://api.weatherapi.com/v1/forecast.json?key=${key}&q=${q}&days=1&aqi=no&alerts=no`,
    {
      timeout: 10000
    }
  )


  const forecastDay = weatherResponse.data.forecast.forecastday[0]
  const weatherData = forecastDay.day

  return {
    max_temp_f: weatherData.maxtemp_f,
    min_temp_f: weatherData.mintemp_f,
    avg_temp_f: weatherData.avgtemp_f,
    precip_in: weatherData.totalprecip_in,
    avg_wind_speed_kts: weatherData.maxwind_kph * 0.539957,
    avg_humidity: Number(weatherData.avghumidity ?? 0),
    condition_text: weatherData.condition?.text ?? null
  }
}

const scoreFlightMatch = (
  f: AviationFlight,
  destination: string,
  airline: string,
  flightDate: string,
  flightTime: string
): number => {
  let score = 0
  const dest = destination.toUpperCase()
  const targetAirline = airline.trim().toLowerCase()

  if (f.arrival?.iata?.toUpperCase() === dest) score += 5
  if (f.airline?.name?.toLowerCase() === targetAirline) score += 4
  if (f.flight_date === flightDate) score += 3

  if (f.departure?.scheduled && flightTime) {
    const candidateTime = new Date(f.departure.scheduled)
    const [hh, mm] = flightTime.split(':').map(Number)
    if (!Number.isNaN(hh) && !Number.isNaN(mm)) {
      const targetMinutes = hh * 60 + mm
      const candidateMinutes = candidateTime.getHours() * 60 + candidateTime.getMinutes()
      const diff = Math.abs(candidateMinutes - targetMinutes)
      if (diff <= 30) score += 3
      else if (diff <= 90) score += 1
    }
  }

  return score
}

const mapMatchedFlight = (flight: AviationFlight | null): MatchedFlightInfo => {
  if (!flight) {
    return {
      status: null,
      airline: null,
      flightNumber: null,
      scheduledDeparture: null,
      estimatedDeparture: null,
      actualDeparture: null,
      departureDelayMinutes: null
    }
  }

  return {
    status: flight.flight_status ?? null,
    airline: flight.airline?.name ?? null,
    flightNumber: flight.flight?.iata ?? flight.flight?.number ?? null,
    scheduledDeparture: flight.departure?.scheduled ?? null,
    estimatedDeparture: flight.departure?.estimated ?? null,
    actualDeparture: flight.departure?.actual ?? null,
    departureDelayMinutes: typeof flight.departure?.delay === 'number' ? flight.departure.delay : null
  }
}

const getAviationFlightData = async (
  origin: string,
  destination: string,
  airline: string,
  flightDate: string,
  flightTime: string
) => {
  const key = process.env.AVIATIONSTACK_API_KEY
  if (!key) {
    return {
      matchedFlight: mapMatchedFlight(null),
      dataSource: 'none' as const
    }
  }

  try {
    const baseUrl = (process.env.AVIATIONSTACK_BASE_URL || 'http://api.aviationstack.com').replace(/\/+$/, '')
    const params: { access_key: string; dep_iata: string; arr_iata: string; flight_date?: string } = {
      access_key: key,
      dep_iata: origin.toUpperCase(),
      arr_iata: destination.toUpperCase(),
      flight_date: flightDate
    }

    let response
    try {
      response = await axios.get(`${baseUrl}/v1/flights`, { params, timeout: 10000 })
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403 && params.flight_date) {
        delete params.flight_date
        response = await axios.get(`${baseUrl}/v1/flights`, { params, timeout: 10000 })
      } else {
        throw error
      }
    }

    const flights: AviationFlight[] = Array.isArray(response.data?.data) ? response.data.data : []
    if (flights.length === 0) {
      return {
        matchedFlight: mapMatchedFlight(null),
        dataSource: 'none' as const
      }
    }

    const best = flights.reduce(
      (acc, cur) => {
        const score = scoreFlightMatch(cur, destination, airline, flightDate, flightTime)
        if (score > acc.score) return { score, flight: cur }
        return acc
      },
      { score: -1, flight: flights[0] }
    )

    return {
      matchedFlight: mapMatchedFlight(best.flight),
      dataSource: 'aviationstack' as const
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      const apiMessage = error.response?.data?.error?.message
      if (status === 401 || status === 403) {
        console.warn('Aviationstack access denied' + (apiMessage ? ': ' + apiMessage : ''))
        return {
          matchedFlight: mapMatchedFlight(null),
          dataSource: 'none' as const
        }
      }
      if (status === 429) {
        console.warn('Aviationstack rate limited')
        return {
          matchedFlight: mapMatchedFlight(null),
          dataSource: 'none' as const
        }
      }
    }
    console.error('Error in getAviationFlightData:', error)
    return {
      matchedFlight: mapMatchedFlight(null),
      dataSource: 'none' as const
    }
  }
}

export const addDataService = async (
  country: string,
  flightDate: string,
  flightTime: string,
  airline: string,
  origin: string,
  destination: string
) => {
  try {
    const distance = getAirportDistance(origin, destination)
    const weather = await getWeatherByAirportCode(origin)
    const aviation = await getAviationFlightData(origin, destination, airline, flightDate, flightTime)

    return {
      distance,
      ...weather,
      aviation
    }
  } catch (error) {
    console.error('Error in addDataService:', error)
    throw new Error('Failed to fetch additional data')
  }
}





