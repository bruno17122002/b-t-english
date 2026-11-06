// Errors that carry a stable code and a learner-facing (Vietnamese) message. Kernel services throw these for
// problems caused by input or state (not found, already done, invalid file…); the IPC router passes them to
// the renderer as-is instead of turning them into a logged 'internal' error.

/** Error with a user-facing message (Vietnamese-first) and a stable code. */
export class UserError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'UserError'
  }
}

/** Removes keys whose value is `undefined` (a renderer may send `{ field: undefined }` for "unchanged"). */
export function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>
}
