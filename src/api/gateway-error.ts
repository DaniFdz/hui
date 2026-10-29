/** Gateway refusals stay distinct from connection failures, so offline reading never hides a rejected request. */
export class GatewayHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "GatewayHttpError";
  }
}

export function isConnectionFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError");
}

export function isGatewayUnavailable(error: unknown): boolean {
  if (error instanceof GatewayHttpError) return [502, 503, 504].includes(error.status);
  return isConnectionFailure(error) || (error instanceof Error && error.cause !== undefined && error.cause !== error && isGatewayUnavailable(error.cause));
}
