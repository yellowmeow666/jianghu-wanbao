import { getApiBaseUrl } from '../config'
import { ApiError, parseErrorBody } from '../utils/errors'

interface RequestOptions {
  method?: 'GET'
  data?: WechatMiniprogram.IAnyObject | string
}

/**
 * 小程序只访问 C 端已发布接口，不附加管理令牌。
 * 失败统一抛 ApiError，页面据此显示空态或错误，不回落到假数据。
 */
export function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = getApiBaseUrl().replace(/\/$/, '')
  const url = `${base}${path}`

  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: options.method ?? 'GET',
      data: options.data,
      timeout: 12000,
      header: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      success(res) {
        const statusCode = res.statusCode || 0
        if (statusCode >= 200 && statusCode < 300) {
          resolve(res.data as T)
          return
        }
        reject(parseErrorBody(res.data, statusCode))
      },
      fail() {
        reject(new ApiError(
          '暂时连不上条目服务。请确认本机后端已启动；开发者工具里需要关闭合法域名校验。',
          'network_error',
          0,
        ))
      },
    })
  })
}
