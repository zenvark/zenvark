import { randomUUID } from 'node:crypto'
import { EventEmitter, setMaxListeners } from 'node:events'
import { setTimeout as setTimeoutAsync } from 'node:timers/promises'
import { Box, render, Text, useApp, useFocus, useInput } from 'ink'
import { Redis } from 'ioredis'
import { createElement, useEffect, useState } from 'react'
import { ConstantBackoff } from 'zenvark/src/backoffs/ConstantBackoff.ts'
import { ConsecutiveBreaker } from 'zenvark/src/breakers/ConsecutiveBreaker.ts'
import { CircuitRoleEnum } from 'zenvark/src/constants.ts'
import { CircuitBreaker } from 'zenvark/src/CircuitBreaker.ts'
import { CircuitOpenError } from 'zenvark/src/errors/circuitOpenError.ts'

const redis = new Redis({
  host: 'localhost',
  port: 6379,
  password: 'sOmE_sEcUrE_pAsS',
})

const circuitEvents = new EventEmitter()
setMaxListeners(50)

let shouldCircuitHealthFail = false

const createCircuit = (instanceId: string) => {
  return new CircuitBreaker({
    id: 'terminal-ui',
    redis,
    breaker: new ConsecutiveBreaker({ threshold: 3 }),
    health: {
      backoff: new ConstantBackoff({ delayMs: 2_000 }),
      check: async (type) => {
        await setTimeoutAsync(10)

        if (shouldCircuitHealthFail) {
          throw new Error('Healthcheck failing by toggle')
        }

        circuitEvents.emit('log', `[${instanceId}] ${type} healthcheck succeeded`)
      },
      idleProbeIntervalMs: 10_000,
    },
    onError(err: Error) {
      circuitEvents.emit('log', `[${instanceId}] error: ${err.message}`)
    },
    onRoleChange(role) {
      circuitEvents.emit('log', `[${instanceId}] role changed to ${role.toUpperCase()}`)
      circuitEvents.emit('roleChange')
    },
    onStateChange(state) {
      circuitEvents.emit('log', `[${instanceId}] state changed to ${state.toUpperCase()}`)
      circuitEvents.emit('stateChange')
    },
  })
}

const instanceA = 'circuitA'
const instanceB = 'circuitB'

const circuitA = createCircuit(instanceA)
const circuitB = createCircuit(instanceB)

type ButtonProps = {
  label: string
  onPress: () => void
}
const Button = ({ label, onPress }: ButtonProps) => {
  const { isFocused } = useFocus()

  useInput((input, key) => {
    if (!isFocused) {
      return
    }
    if (key.return || input === ' ') {
      onPress()
    }
  })

  return (
    <Box borderStyle="round" paddingX={1} borderColor={isFocused ? 'yellow' : 'gray'}>
      <Text color={isFocused ? 'yellow' : undefined}>{label}</Text>
    </Box>
  )
}

type RadioOptionProps = {
  label: string
  selected: boolean
  selectedColor: string
  onSelect: () => void
}
const RadioOption = ({ label, selected, selectedColor, onSelect }: RadioOptionProps) => {
  const { isFocused } = useFocus()

  useInput((input, key) => {
    if (!isFocused) {
      return
    }
    if (key.return || input === ' ') {
      onSelect()
    }
  })

  return (
    <Text color={isFocused ? 'yellow' : selected ? selectedColor : undefined}>
      {selected ? '(●)' : '(○)'} {label}
    </Text>
  )
}

type RadioGroupOption = {
  label: string
  value: string
  selectedColor: string
}
type RadioGroupProps = {
  options: RadioGroupOption[]
  value: string
  onChange: (v: string) => void
}
const RadioGroup = ({ options, value, onChange }: RadioGroupProps) => {
  return (
    <Box flexDirection="column">
      {options.map((opt) => (
        <RadioOption
          key={opt.value}
          label={opt.label}
          selectedColor={opt.selectedColor}
          selected={value === opt.value}
          onSelect={() => onChange(opt.value)}
        />
      ))}
    </Box>
  )
}

type HealthcheckBoxProps = {
  shouldFail: boolean
  setShouldFail: (value: boolean) => void
}
const HealthcheckBox = ({ shouldFail, setShouldFail }: HealthcheckBoxProps) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Box marginBottom={1}>
        <Text>Healthcheck returns</Text>
      </Box>
      <RadioGroup
        options={[
          { label: 'Success', value: 'success', selectedColor: 'green' },
          { label: 'Failure', value: 'failure', selectedColor: 'red' },
        ]}
        value={shouldFail ? 'failure' : 'success'}
        onChange={(v) => setShouldFail(v === 'failure')}
      />
    </Box>
  )
}

type CircuitBoxProps = {
  title: string
  role: string
  state: string
  isOperational: boolean
  onSuccess: () => void
  onFail: () => void
  onStart: () => void
  onStop: () => void
}
const CircuitBox = ({
  title,
  role,
  state,
  isOperational,
  onSuccess,
  onFail,
  onStart,
  onStop,
}: CircuitBoxProps) => {
  const stateColor = state === 'open' ? 'red' : 'green'
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box>
        <Text>
          {title}{' '}
          <Text color={isOperational ? 'green' : 'red'}>
            {isOperational ? 'STARTED' : 'STOPPED'}
          </Text>
        </Text>
      </Box>
      <Box>
        <Button label="Start" onPress={onStart} />
        <Button label="Stop" onPress={onStop} />
      </Box>

      <Box marginTop={1}>
        <Text>
          Status:
          <Text color={role === CircuitRoleEnum.LEADER ? 'yellow' : 'gray'}>
            {role.toUpperCase()}
          </Text>
          -<Text color={stateColor}>{state.toUpperCase()}</Text>
        </Text>
      </Box>
      <Box>
        <Button label="Trigger Success" onPress={onSuccess} />
        <Button label="Trigger Failure" onPress={onFail} />
      </Box>
    </Box>
  )
}

const App = () => {
  const { exit } = useApp()

  const [refreshCounter, setRefreshCounter] = useState(0)

  const triggerRefresh = () => setRefreshCounter((i) => i + 1)

  // biome-ignore lint/correctness/useExhaustiveDependencies: it's fine
  useEffect(() => {
    const timer = setInterval(() => {
      triggerRefresh()
    }, 1000)

    return () => {
      clearInterval(timer)
    }
  }, [])

  const [logs, setLogs] = useState<Array<{ id: string; message: string }>>([])

  const addLog = (message: string) => {
    setLogs((prev) => [
      ...prev.slice(-9),
      {
        id: randomUUID(),
        message,
      },
    ])
  }

  const [healthFail, setHealthFail] = useState(shouldCircuitHealthFail)

  useEffect(() => {
    shouldCircuitHealthFail = healthFail
  }, [healthFail])

  // biome-ignore lint/correctness/useExhaustiveDependencies: it's fine
  useEffect(() => {
    const handleLog = (message: string) => addLog(message)

    circuitEvents.on('log', handleLog)
    circuitEvents.on('stateChange', triggerRefresh)
    circuitEvents.on('roleChange', triggerRefresh)

    return () => {
      circuitEvents.off('log', handleLog)
      circuitEvents.off('stateChange', triggerRefresh)
      circuitEvents.off('roleChange', triggerRefresh)
    }
  }, [])

  async function shutdown() {
    try {
      exit()
      await Promise.all([circuitA.stop(), circuitB.stop()])
      await redis.quit()
      process.exit(0)
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: it is fine to use console in cli app
      console.error(err)
      process.exit(1)
    }
  }

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c') || input === 'q') {
      void shutdown()
    }
  })

  async function executeOn(
    circuit: CircuitBreaker,
    instanceId: string,
    shouldFail: boolean,
  ) {
    if (!circuit.isOperational) {
      addLog(`[${instanceId}] circuit has to be started first`)
      return
    }
    try {
      await circuit.execute(async () => {
        await setTimeoutAsync(100)
        if (shouldFail) {
          throw new Error('execute failure triggered')
        }
      })
      addLog(`[${instanceId}] executed successful call`)
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        addLog(`[${instanceId}] execute blocked - circuit is OPEN`)
      } else {
        addLog(`[${instanceId}] execution failed`)
      }
    }
    triggerRefresh()
  }

  async function startCircuit(circuit: CircuitBreaker, instanceId: string) {
    await circuit.start()
    addLog(`[${instanceId}] started`)

    triggerRefresh()
  }

  async function stopCircuit(circuit: CircuitBreaker, instanceId: string) {
    await circuit.stop()
    addLog(`[${instanceId}] stopped`)

    triggerRefresh()
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box>
        <Text>
          Press Tab to focus next element, Shift+Tab for previous. Enter/Space to activate. Esc/q to
          quit. Tick: {refreshCounter}
        </Text>
      </Box>
      <Box gap={1}>
        <HealthcheckBox shouldFail={healthFail} setShouldFail={setHealthFail} />
        <CircuitBox
          title={instanceA}
          role={circuitA.role}
          state={circuitA.state}
          isOperational={circuitA.isOperational}
          onSuccess={() => executeOn(circuitA, instanceA, false)}
          onFail={() => executeOn(circuitA, instanceA, true)}
          onStart={() => startCircuit(circuitA, instanceA)}
          onStop={() => stopCircuit(circuitA, instanceA)}
        />
        <CircuitBox
          title={instanceB}
          role={circuitB.role}
          state={circuitB.state}
          isOperational={circuitB.isOperational}
          onSuccess={() => executeOn(circuitB, instanceB, false)}
          onFail={() => executeOn(circuitB, instanceB, true)}
          onStart={() => startCircuit(circuitB, instanceB)}
          onStop={() => stopCircuit(circuitB, instanceB)}
        />
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text>Logs:</Text>
        {logs.map((log) => (
          <Text key={log.id}>{log.message}</Text>
        ))}
      </Box>
    </Box>
  )
}

render(createElement(App))
