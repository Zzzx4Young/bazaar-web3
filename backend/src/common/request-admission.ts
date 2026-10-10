// Keep accepted work bounded before authentication and database acquisition.
// Only response processing releases a slot: a disconnected client can leave server
// work running until database timeouts settle it, so socket close alone is insufficient.
export class RequestAdmission {
  private readonly accepted = new Set<object>()

  constructor(private readonly limit: number) {}

  acquire(request: object) {
    if (this.accepted.size >= this.limit) return false
    this.accepted.add(request)
    return true
  }

  release(request: object) {
    this.accepted.delete(request)
  }
}
