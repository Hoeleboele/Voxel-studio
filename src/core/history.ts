export interface Command {
  label: string
  undo(): void
  redo(): void
}

const MAX_STEPS = 200

class History {
  private stack: Command[] = []
  private index = 0
  private listeners = new Set<() => void>()
  version = 0

  push(cmd: Command): void {
    this.stack.length = this.index
    this.stack.push(cmd)
    if (this.stack.length > MAX_STEPS) this.stack.shift()
    this.index = this.stack.length
    this.emit()
  }

  undo(): string | null {
    if (this.index === 0) return null
    const cmd = this.stack[--this.index]
    cmd.undo()
    this.emit()
    return cmd.label
  }

  redo(): string | null {
    if (this.index >= this.stack.length) return null
    const cmd = this.stack[this.index++]
    cmd.redo()
    this.emit()
    return cmd.label
  }

  get canUndo(): boolean { return this.index > 0 }
  get canRedo(): boolean { return this.index < this.stack.length }
  get undoLabel(): string | null { return this.index > 0 ? this.stack[this.index - 1].label : null }
  get redoLabel(): string | null { return this.index < this.stack.length ? this.stack[this.index].label : null }

  clear(): void {
    this.stack = []
    this.index = 0
    this.emit()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    this.version++
    for (const fn of this.listeners) fn()
  }
}

export const history = new History()

export class CompositeCommand implements Command {
  constructor(public label: string, private cmds: Command[]) {}
  undo(): void { for (let i = this.cmds.length - 1; i >= 0; i--) this.cmds[i].undo() }
  redo(): void { for (const c of this.cmds) c.redo() }
}

export class StateCommand<T> implements Command {
  constructor(public label: string, private before: T, private after: T, private apply: (s: T) => void) {}
  undo(): void { this.apply(this.before) }
  redo(): void { this.apply(this.after) }
}
