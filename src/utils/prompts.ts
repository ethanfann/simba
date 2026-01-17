import * as p from "@clack/prompts"
import type { Agent } from "../core/types"

export function isCancel(value: unknown): value is symbol {
  return p.isCancel(value)
}

export function cancel(message = "Operation cancelled."): never {
  p.cancel(message)
  process.exit(0)
}

export async function selectAgent(
  agents: Record<string, Agent>,
  message: string,
  filter?: (agent: Agent) => boolean
): Promise<string> {
  const options = Object.entries(agents)
    .filter(([_, a]) => a.detected && (!filter || filter(a)))
    .map(([id, a]) => ({ value: id, label: a.name }))

  if (options.length === 0) {
    p.log.error("No agents available.")
    process.exit(1)
  }

  const result = await p.select({ message, options })
  if (isCancel(result)) cancel()
  return result as string
}

export async function selectMultipleAgents(
  agents: Record<string, Agent>,
  message: string,
  exclude?: string[]
): Promise<string[]> {
  const options = Object.entries(agents)
    .filter(([id, a]) => a.detected && !exclude?.includes(id))
    .map(([id, a]) => ({ value: id, label: a.name }))

  if (options.length === 0) {
    p.log.error("No agents available.")
    process.exit(1)
  }

  const result = await p.multiselect({ message, options, required: true })
  if (isCancel(result)) cancel()
  return result as string[]
}

export async function selectFromList<T extends string>(
  message: string,
  options: { value: T; label: string; hint?: string }[]
): Promise<T> {
  if (options.length === 0) {
    p.log.error("No options available.")
    process.exit(1)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await p.select({ message, options: options as any })
  if (isCancel(result)) cancel()
  return result as T
}

export async function inputText(
  message: string,
  options?: { placeholder?: string; defaultValue?: string }
): Promise<string> {
  const result = await p.text({
    message,
    placeholder: options?.placeholder,
    defaultValue: options?.defaultValue,
  })
  if (isCancel(result)) cancel()
  return result as string
}

export async function confirm(message: string, initial = false): Promise<boolean> {
  const result = await p.confirm({ message, initialValue: initial })
  if (isCancel(result)) cancel()
  return result as boolean
}

export { p }
