/** 契约错误体：{ error: { code, message } }。网络失败也收成同一种错误，页面只处理这一类。 */
export class ApiError extends Error {
  code: string
  statusCode: number

  constructor(message: string, code: string, statusCode: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.statusCode = statusCode
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseErrorBody(body: unknown, statusCode: number): ApiError {
  if (isRecord(body) && isRecord(body.error)) {
    const code = typeof body.error.code === 'string' && body.error.code.trim()
      ? body.error.code
      : `http_${statusCode}`
    const message = typeof body.error.message === 'string' && body.error.message.trim()
      ? body.error.message
      : '请求没有成功'
    return new ApiError(message, code, statusCode)
  }

  if (typeof body === 'string' && body.trim()) {
    return new ApiError(body.trim().slice(0, 180), `http_${statusCode}`, statusCode)
  }

  return new ApiError('请求没有成功', `http_${statusCode}`, statusCode)
}

export function toUiError(error: unknown): { message: string; code: string } {
  if (error instanceof ApiError) {
    return { message: error.message, code: error.code }
  }
  return { message: '读取条目时出了问题，请稍后再试。', code: 'client_error' }
}
