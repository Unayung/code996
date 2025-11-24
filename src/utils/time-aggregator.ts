import { TimeCount } from '../types/git-types'

/**
 * 時間資料聚合工具
 * 用於將半小時粒度（48点）資料聚合為小時粒度（24点）
 */
export class TimeAggregator {
  /**
   * 將48個半小時点聚合為24個小時点
   * @param halfHourData 半小時粒度資料（48点）
   * @returns 小時粒度資料（24点）
   */
  static aggregateToHour(halfHourData: TimeCount[]): TimeCount[] {
    const hourMap = new Map<string, number>()

    // 初始化24小時
    for (let i = 0; i < 24; i++) {
      const hour = i.toString().padStart(2, '0')
      hourMap.set(hour, 0)
    }

    // 聚合半小時資料
    for (const item of halfHourData) {
      // 提取小時部分：'09:30' -> '09', '09:00' -> '09'
      const hourMatch = item.time.match(/^(\d{2})/)
      if (hourMatch) {
        const hour = hourMatch[1]
        const currentCount = hourMap.get(hour) || 0
        hourMap.set(hour, currentCount + item.count)
      }
    }

    // 轉為陣列
    const result: TimeCount[] = []
    for (let i = 0; i < 24; i++) {
      const hour = i.toString().padStart(2, '0')
      result.push({
        time: hour,
        count: hourMap.get(hour) || 0,
      })
    }

    return result
  }

  /**
   * 檢測資料粒度
   * @param data 時間資料
   * @returns 'half-hour' 或 'hour'
   */
  static detectGranularity(data: TimeCount[]): 'half-hour' | 'hour' {
    if (data.length === 48) {
      return 'half-hour'
    }
    if (data.length === 24) {
      return 'hour'
    }
    // 通過檢查是否包含冒號來判斷
    const hasColon = data.some((item) => item.time.includes(':'))
    return hasColon ? 'half-hour' : 'hour'
  }
}
