'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Button,
  Empty,
  Layout,
  Progress,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  notification,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  EyeOutlined,
  ReloadOutlined,
  ThunderboltFilled,
  WifiOutlined,
} from '@ant-design/icons'
import { useWebSocket } from '../hooks/useWebSocket'
import type { Robot, WebSocketMessage } from '../types/robot'

const { Header, Content } = Layout
const { Text, Title } = Typography

const API_BASE_URL = (process.env.API_BASE_URL || '/api').replace(/\/$/, '')
const WEBSOCKET_URL = (process.env.WEBSOCKET_URL || 'ws://localhost:8080').replace(/\/$/, '')
const OFFLINE_THRESHOLD_MS = 15_000
const CRITICAL_BATTERY_MS = 5 * 60 * 1000
const CLOCK_TICK_MS = 1000

type RobotStatus = 'online' | 'offline' | 'warning'

interface DashboardRobot extends Robot {
  key: string
  status: RobotStatus
  lastSeenTime: number
}

interface RobotsResponse {
  robots: Robot[]
}

interface BatteryAlertState {
  lowSince: number | null
  lowNotified: boolean
  criticalNotified: boolean
}

function getLastSeenTime(robot: Robot): number {
  const lastSeen = robot.lastSeen || robot.timestamp
  const lastSeenTime = new Date(lastSeen).getTime()
  return Number.isFinite(lastSeenTime) ? lastSeenTime : 0
}

function isLowBattery(robot: Robot): boolean {
  return robot.batteryPercentage < 20 && !robot.isCharging
}

function getRobotStatus(robot: Robot, now: number): RobotStatus {
  const isOffline = now - getLastSeenTime(robot) > OFFLINE_THRESHOLD_MS

  if (isOffline) {
    return 'offline'
  }

  if (isLowBattery(robot)) {
    return 'warning'
  }

  return 'online'
}

function formatPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function formatRelativeTime(timestamp: number, now: number): string {
  if (!timestamp) {
    return 'Unknown'
  }

  const elapsedSeconds = Math.max(0, Math.round((now - timestamp) / 1000))

  if (elapsedSeconds < 5) {
    return 'Just now'
  }

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`
  }

  const elapsedMinutes = Math.round(elapsedSeconds / 60)
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`
  }

  const elapsedHours = Math.round(elapsedMinutes / 60)
  return `${elapsedHours}h ago`
}

function getWifiColor(signal: number): string {
  if (signal >= -55) {
    return 'green'
  }

  if (signal >= -75) {
    return 'gold'
  }

  return 'red'
}

function getStatusTag(status: RobotStatus) {
  const config = {
    online: { color: 'green', label: 'Online' },
    warning: { color: 'gold', label: 'Warning' },
    offline: { color: 'red', label: 'Offline' },
  }[status]

  return <Tag color={config.color}>{config.label}</Tag>
}

export default function Dashboard() {
  const router = useRouter()
  const [robotsById, setRobotsById] = useState<Record<string, Robot>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [notificationApi, notificationContextHolder] = notification.useNotification()
  const alertStateRef = useRef<Record<string, BatteryAlertState>>({})
  const { isConnected, lastMessage, reconnect } = useWebSocket(`${WEBSOCKET_URL}/dashboard`)

  const robots = useMemo<DashboardRobot[]>(() => (
    Object.values(robotsById)
      .sort((left, right) => left.robotId.localeCompare(right.robotId))
      .map((robot) => {
        const lastSeenTime = getLastSeenTime(robot)

        return {
          ...robot,
          key: robot.robotId,
          lastSeenTime,
          status: getRobotStatus(robot, now),
        }
      })
  ), [now, robotsById])

  const onlineCount = robots.filter((robot) => robot.status === 'online').length
  const warningCount = robots.filter((robot) => robot.status === 'warning').length
  const offlineCount = robots.filter((robot) => robot.status === 'offline').length

  const loadRobots = async () => {
    setIsLoading(true)
    setFetchError(null)

    try {
      const response = await fetch(`${API_BASE_URL}/robots`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`)
      }

      const payload = await response.json() as RobotsResponse
      const nextRobots = Array.isArray(payload.robots) ? payload.robots : []

      setRobotsById(() => nextRobots.reduce<Record<string, Robot>>((accumulator, robot) => {
        accumulator[robot.robotId] = robot
        return accumulator
      }, {}))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load robots'
      setFetchError(message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadRobots()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, CLOCK_TICK_MS)

    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!lastMessage) {
      return
    }

    try {
      const message = JSON.parse(lastMessage) as WebSocketMessage

      if (message.type === 'robot_update' && message.data?.robotId) {
        setRobotsById((currentRobots) => ({
          ...currentRobots,
          [message.data!.robotId]: message.data!,
        }))
      }
    } catch (error) {
      console.warn('Unable to parse dashboard WebSocket message:', error)
    }
  }, [lastMessage])

  useEffect(() => {
    robots.forEach((robot) => {
      const existingState = alertStateRef.current[robot.robotId] || {
        lowSince: null,
        lowNotified: false,
        criticalNotified: false,
      }

      if (!isLowBattery(robot)) {
        alertStateRef.current[robot.robotId] = {
          lowSince: null,
          lowNotified: false,
          criticalNotified: false,
        }
        return
      }

      const lowSince = existingState.lowSince || now

      if (!existingState.lowNotified) {
        notificationApi.warning({
          key: `low-battery-${robot.robotId}`,
          message: `Robot ${robot.robotId} is low battery!`,
          description: `Battery is ${robot.batteryPercentage.toFixed(1)}% and the robot is not charging.`,
          placement: 'topRight',
        })
      }

      if (!existingState.criticalNotified && now - lowSince >= CRITICAL_BATTERY_MS) {
        notificationApi.error({
          key: `critical-battery-${robot.robotId}`,
          message: `Robot ${robot.robotId} will be shut down soon!`,
          description: 'Battery has stayed below 20% without charging for at least 5 minutes.',
          placement: 'topRight',
        })
      }

      alertStateRef.current[robot.robotId] = {
        lowSince,
        lowNotified: true,
        criticalNotified: existingState.criticalNotified || now - lowSince >= CRITICAL_BATTERY_MS,
      }
    })
  }, [notificationApi, now, robots])

  const navigateToRobot = (robotId: string) => {
    router.push(`/robots/${encodeURIComponent(robotId)}`)
  }

  const columns: ColumnsType<DashboardRobot> = [
    {
      title: 'Robot',
      dataIndex: 'robotId',
      key: 'robotId',
      fixed: 'left',
      width: 140,
      sorter: (left, right) => left.robotId.localeCompare(right.robotId),
      render: (robotId: string) => <Text strong>{robotId}</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      filters: [
        { text: 'Online', value: 'online' },
        { text: 'Warning', value: 'warning' },
        { text: 'Offline', value: 'offline' },
      ],
      onFilter: (value, robot) => robot.status === value,
      render: (status: RobotStatus) => getStatusTag(status),
    },
    {
      title: 'Battery',
      dataIndex: 'batteryPercentage',
      key: 'batteryPercentage',
      width: 170,
      sorter: (left, right) => left.batteryPercentage - right.batteryPercentage,
      render: (batteryPercentage: number, robot) => (
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          <Progress
            percent={formatPercent(batteryPercentage)}
            size="small"
            status={isLowBattery(robot) ? 'exception' : 'normal'}
          />
          <Text type={isLowBattery(robot) ? 'danger' : undefined}>
            {batteryPercentage.toFixed(1)}%
          </Text>
        </Space>
      ),
    },
    {
      title: 'WiFi',
      dataIndex: 'wifiSignalStrength',
      key: 'wifiSignalStrength',
      width: 130,
      sorter: (left, right) => left.wifiSignalStrength - right.wifiSignalStrength,
      render: (wifiSignalStrength: number) => (
        <Tag color={getWifiColor(wifiSignalStrength)} icon={<WifiOutlined />}>
          {wifiSignalStrength} dBm
        </Tag>
      ),
    },
    {
      title: 'Charging',
      dataIndex: 'isCharging',
      key: 'isCharging',
      width: 120,
      filters: [
        { text: 'Charging', value: true },
        { text: 'Not charging', value: false },
      ],
      onFilter: (value, robot) => robot.isCharging === value,
      render: (isCharging: boolean) => (
        <Tag color={isCharging ? 'blue' : 'default'} icon={isCharging ? <ThunderboltFilled /> : undefined}>
          {isCharging ? 'Charging' : 'No'}
        </Tag>
      ),
    },
    {
      title: 'Temp',
      dataIndex: 'temperature',
      key: 'temperature',
      width: 110,
      sorter: (left, right) => left.temperature - right.temperature,
      render: (temperature: number) => (
        <Text type={temperature >= 70 ? 'danger' : undefined}>
          {temperature.toFixed(1)} C
        </Text>
      ),
    },
    {
      title: 'Memory',
      dataIndex: 'memoryUsage',
      key: 'memoryUsage',
      width: 160,
      sorter: (left, right) => left.memoryUsage - right.memoryUsage,
      render: (memoryUsage: number) => (
        <Progress percent={formatPercent(memoryUsage)} size="small" />
      ),
    },
    {
      title: 'Last seen',
      dataIndex: 'lastSeenTime',
      key: 'lastSeenTime',
      width: 140,
      sorter: (left, right) => left.lastSeenTime - right.lastSeenTime,
      render: (lastSeenTime: number) => (
        <Tooltip title={lastSeenTime ? new Date(lastSeenTime).toLocaleString() : 'Unknown'}>
          <Text type={now - lastSeenTime > OFFLINE_THRESHOLD_MS ? 'danger' : 'secondary'}>
            {formatRelativeTime(lastSeenTime, now)}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 64,
      align: 'right',
      render: (_, robot) => (
        <Tooltip title="View robot">
          <Button
            aria-label={`View robot ${robot.robotId}`}
            icon={<EyeOutlined />}
            onClick={(event) => {
              event.stopPropagation()
              navigateToRobot(robot.robotId)
            }}
          />
        </Tooltip>
      ),
    },
  ]

  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f7fb' }}>
      {notificationContextHolder}

      <Header style={{ background: '#152238', height: 64, padding: '0 24px' }}>
        <div style={{ alignItems: 'center', display: 'flex', height: '100%', justifyContent: 'space-between' }}>
          <Title level={3} style={{ color: 'white', margin: 0 }}>
            Robot Fleet Dashboard
          </Title>
          <Space>
            <Tag color={isConnected ? 'green' : 'red'}>
              {isConnected ? 'Live connected' : 'Live disconnected'}
            </Tag>
            <Tooltip title="Reconnect live feed">
              <Button
                aria-label="Reconnect live feed"
                icon={<ReloadOutlined />}
                onClick={reconnect}
              />
            </Tooltip>
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
              gap: 24,
              justifyContent: 'space-between',
            }}
          >
            <Space size={32} wrap>
              <Statistic title="Robots" value={robots.length} />
              <Statistic title="Online" value={onlineCount} valueStyle={{ color: '#3f8600' }} />
              <Statistic title="Warnings" value={warningCount} valueStyle={{ color: '#d48806' }} />
              <Statistic title="Offline" value={offlineCount} valueStyle={{ color: '#cf1322' }} />
            </Space>

            <Button
              icon={<ReloadOutlined />}
              loading={isLoading}
              onClick={loadRobots}
            >
              Refresh
            </Button>
          </div>

          {fetchError ? (
            <Alert
              action={(
                <Button size="small" onClick={loadRobots}>
                  Retry
                </Button>
              )}
              message="Unable to load robots"
              description={fetchError}
              showIcon
              type="error"
            />
          ) : null}

          <Table<DashboardRobot>
            columns={columns}
            dataSource={robots}
            loading={isLoading}
            locale={{
              emptyText: (
                <Empty
                  description="No robot telemetry yet"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ),
            }}
            onRow={(robot) => ({
              onClick: () => navigateToRobot(robot.robotId),
              style: { cursor: 'pointer' },
            })}
            pagination={{
              defaultPageSize: 10,
              hideOnSinglePage: true,
              showSizeChanger: true,
            }}
            scroll={{ x: 1150 }}
            size="middle"
          />
        </Space>
      </Content>
    </Layout>
  )
}
