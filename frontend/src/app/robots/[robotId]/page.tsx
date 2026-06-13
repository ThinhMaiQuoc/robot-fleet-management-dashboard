'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Alert,
  Button,
  Card,
  Empty,
  Layout,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
} from 'antd'
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  ThunderboltFilled,
  WifiOutlined,
} from '@ant-design/icons'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useWebSocket } from '../../../hooks/useWebSocket'
import type { ChartDataPoint, Robot, WebSocketMessage } from '../../../types/robot'

const { Header, Content } = Layout
const { Text, Title } = Typography

const API_BASE_URL = (process.env.API_BASE_URL || '/api').replace(/\/$/, '')
const WEBSOCKET_URL = (process.env.WEBSOCKET_URL || 'ws://localhost:8080').replace(/\/$/, '')
const HISTORY_HOURS = 6
const HISTORY_WINDOW_MS = HISTORY_HOURS * 60 * 60 * 1000

interface HistoryResponse {
  robotId: string
  hours: number
  data: Robot[]
}

interface DetailChartPoint extends ChartDataPoint {
  time: number
  chargingValue: number
}

interface MetricChartProps {
  color: string
  data: DetailChartPoint[]
  dataKey: keyof Pick<DetailChartPoint, 'batteryPercentage' | 'wifiSignalStrength' | 'temperature' | 'memoryUsage'>
  title: string
  unit: string
  yDomain?: [number | string, number | string]
}

function decodeRouteParam(value: string | string[] | undefined): string {
  const routeValue = Array.isArray(value) ? value[0] : value

  if (!routeValue) {
    return ''
  }

  try {
    return decodeURIComponent(routeValue)
  } catch {
    return routeValue
  }
}

function toChartPoint(robot: Robot): DetailChartPoint | null {
  const time = new Date(robot.timestamp).getTime()

  if (!Number.isFinite(time)) {
    return null
  }

  return {
    timestamp: robot.timestamp,
    batteryPercentage: robot.batteryPercentage,
    wifiSignalStrength: robot.wifiSignalStrength,
    isCharging: robot.isCharging,
    temperature: robot.temperature,
    memoryUsage: robot.memoryUsage,
    time,
    chargingValue: robot.isCharging ? 1 : 0,
  }
}

function mergeChartPoints(
  currentPoints: DetailChartPoint[],
  incomingPoints: DetailChartPoint[],
  referenceTime = Date.now()
): DetailChartPoint[] {
  const cutoffTime = referenceTime - HISTORY_WINDOW_MS
  const pointsByTimestamp = new Map<string, DetailChartPoint>()

  currentPoints.concat(incomingPoints).forEach((point) => {
    if (point.time >= cutoffTime) {
      pointsByTimestamp.set(point.timestamp, point)
    }
  })

  return Array.from(pointsByTimestamp.values())
    .sort((left, right) => left.time - right.time)
}

function formatAxisTime(value: number | string): string {
  const time = Number(value)

  if (!Number.isFinite(time)) {
    return ''
  }

  return new Date(time).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatFullTime(value: number | string): string {
  const time = Number(value)

  if (!Number.isFinite(time)) {
    return ''
  }

  return new Date(time).toLocaleString()
}

function formatMetricValue(value: unknown, unit: string): string {
  const numericValue = Number(value)

  if (!Number.isFinite(numericValue)) {
    return String(value)
  }

  const precision = unit === 'dBm' ? 0 : 1
  return `${numericValue.toFixed(precision)} ${unit}`.trim()
}

function MetricChart({ color, data, dataKey, title, unit, yDomain }: MetricChartProps) {
  return (
    <Card size="small" title={title}>
      <div style={{ height: 260 }}>
        <ResponsiveContainer height="100%" width="100%">
          <LineChart data={data} margin={{ bottom: 8, left: 4, right: 16, top: 8 }}>
            <CartesianGrid stroke="#edf0f5" strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              domain={['dataMin', 'dataMax']}
              minTickGap={28}
              tickFormatter={formatAxisTime}
              type="number"
            />
            <YAxis domain={yDomain} width={58} />
            <ChartTooltip
              formatter={(value) => [formatMetricValue(value, unit), title]}
              labelFormatter={formatFullTime}
            />
            <Line
              dataKey={dataKey}
              dot={false}
              isAnimationActive={false}
              stroke={color}
              strokeWidth={2}
              type="monotone"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

function ChargingChart({ data }: { data: DetailChartPoint[] }) {
  return (
    <Card size="small" title="Charging Status">
      <div style={{ height: 260 }}>
        <ResponsiveContainer height="100%" width="100%">
          <LineChart data={data} margin={{ bottom: 8, left: 4, right: 16, top: 8 }}>
            <CartesianGrid stroke="#edf0f5" strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              domain={['dataMin', 'dataMax']}
              minTickGap={28}
              tickFormatter={formatAxisTime}
              type="number"
            />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 1]}
              tickFormatter={(value) => (Number(value) === 1 ? 'Charging' : 'Idle')}
              width={88}
            />
            <ChartTooltip
              formatter={(value) => [
                Number(value) === 1 ? 'Charging' : 'Not charging',
                'Charging',
              ]}
              labelFormatter={formatFullTime}
            />
            <Line
              dataKey="chargingValue"
              dot={false}
              isAnimationActive={false}
              stroke="#1677ff"
              strokeWidth={2}
              type="stepAfter"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

export default function RobotDetailPage() {
  const router = useRouter()
  const params = useParams<{ robotId: string }>()
  const robotId = useMemo(() => decodeRouteParam(params?.robotId), [params])
  const [points, setPoints] = useState<DetailChartPoint[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const { isConnected, lastMessage, reconnect } = useWebSocket(`${WEBSOCKET_URL}/dashboard`)

  const latestPoint = points[points.length - 1]

  const loadHistory = useCallback(async () => {
    if (!robotId) {
      return
    }

    setIsLoading(true)
    setFetchError(null)

    try {
      const response = await fetch(
        `${API_BASE_URL}/robots/${encodeURIComponent(robotId)}/history?hours=${HISTORY_HOURS}`,
        { cache: 'no-store' }
      )

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`)
      }

      const payload = await response.json() as HistoryResponse
      const nextPoints = Array.isArray(payload.data)
        ? payload.data.map(toChartPoint).filter((point): point is DetailChartPoint => Boolean(point))
        : []

      setPoints(mergeChartPoints([], nextPoints))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load robot history'
      setFetchError(message)
    } finally {
      setIsLoading(false)
    }
  }, [robotId])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    if (!lastMessage || !robotId) {
      return
    }

    try {
      const message = JSON.parse(lastMessage) as WebSocketMessage

      if (message.type !== 'robot_update' || message.data?.robotId !== robotId) {
        return
      }

      const nextPoint = toChartPoint(message.data)

      if (!nextPoint) {
        return
      }

      setPoints((currentPoints) => mergeChartPoints(currentPoints, [nextPoint]))
    } catch (error) {
      console.warn('Unable to parse robot detail WebSocket message:', error)
    }
  }, [lastMessage, robotId])

  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f7fb' }}>
      <Header style={{ background: '#152238', height: 64, padding: '0 24px' }}>
        <div style={{ alignItems: 'center', display: 'flex', height: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Button
              aria-label="Back to dashboard"
              icon={<ArrowLeftOutlined />}
              onClick={() => router.push('/')}
            />
            <Title level={3} style={{ color: 'white', margin: 0 }}>
              {robotId || 'Robot Detail'}
            </Title>
          </Space>
          <Space>
            <Tag color={isConnected ? 'green' : 'red'}>
              {isConnected ? 'Live connected' : 'Live disconnected'}
            </Tag>
            <Button
              aria-label="Reconnect live feed"
              icon={<ReloadOutlined />}
              onClick={reconnect}
            />
          </Space>
        </div>
      </Header>

      <Content style={{ padding: 24 }}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div
            style={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              justifyContent: 'space-between',
            }}
          >
            <div>
              <Title level={4} style={{ marginBottom: 4 }}>
                Historical Telemetry
              </Title>
              <Text type="secondary">
                Latest {HISTORY_HOURS} hours, oldest to newest
              </Text>
            </div>
            <Button icon={<ReloadOutlined />} loading={isLoading} onClick={loadHistory}>
              Refresh
            </Button>
          </div>

          {fetchError ? (
            <Alert
              action={(
                <Button size="small" onClick={loadHistory}>
                  Retry
                </Button>
              )}
              description={fetchError}
              message="Unable to load robot history"
              showIcon
              type="error"
            />
          ) : null}

          {latestPoint ? (
            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              }}
            >
              <Card size="small">
                <Statistic suffix="%" title="Battery" value={latestPoint.batteryPercentage} precision={1} />
              </Card>
              <Card size="small">
                <Statistic
                  prefix={<WifiOutlined />}
                  suffix="dBm"
                  title="WiFi"
                  value={latestPoint.wifiSignalStrength}
                />
              </Card>
              <Card size="small">
                <Statistic suffix="C" title="Temperature" value={latestPoint.temperature} precision={1} />
              </Card>
              <Card size="small">
                <Statistic suffix="%" title="Memory" value={latestPoint.memoryUsage} precision={0} />
              </Card>
              <Card size="small">
                <Space direction="vertical" size={4}>
                  <Text type="secondary">Charging</Text>
                  <Tag color={latestPoint.isCharging ? 'blue' : 'default'} icon={latestPoint.isCharging ? <ThunderboltFilled /> : undefined}>
                    {latestPoint.isCharging ? 'Charging' : 'Not charging'}
                  </Tag>
                </Space>
              </Card>
            </div>
          ) : null}

          {latestPoint ? (
            <Text type="secondary">
              Latest telemetry: {formatFullTime(latestPoint.time)}
            </Text>
          ) : null}

          {isLoading && points.length === 0 ? (
            <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'center', minHeight: 320 }}>
              <Spin />
            </div>
          ) : null}

          {!isLoading && points.length === 0 && !fetchError ? (
            <Empty description="No history found for this robot in the latest 6 hours" />
          ) : null}

          {points.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gap: 16,
                gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              }}
            >
              <MetricChart
                color="#1677ff"
                data={points}
                dataKey="batteryPercentage"
                title="Battery Percentage"
                unit="%"
                yDomain={[0, 100]}
              />
              <MetricChart
                color="#13a8a8"
                data={points}
                dataKey="wifiSignalStrength"
                title="WiFi Signal Strength"
                unit="dBm"
                yDomain={[-100, 0]}
              />
              <MetricChart
                color="#d46b08"
                data={points}
                dataKey="temperature"
                title="Temperature"
                unit="C"
              />
              <MetricChart
                color="#722ed1"
                data={points}
                dataKey="memoryUsage"
                title="Memory Usage"
                unit="%"
                yDomain={[0, 100]}
              />
              <ChargingChart data={points} />
            </div>
          ) : null}
        </Space>
      </Content>
    </Layout>
  )
}
