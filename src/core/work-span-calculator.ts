import { DailyWorkSpan } from '../types/git-types'
import { getWorkdayChecker } from '../utils/workday-checker'

/**
 * 工作跨度計算器
 * 計算每日的工作時間跨度（首次提交到最後提交的時間差）
 */
export class WorkSpanCalculator {
  /**
   * 從提交資料中計算每日工作跨度
   * @param commits 提交資料陣列，每個元素包含 timestamp
   * @returns 每日工作跨度陣列
   */
  static calculateDailyWorkSpans(commits: Array<{ timestamp: number }>): DailyWorkSpan[] {
    if (!commits || commits.length === 0) {
      return []
    }

    // 按日期分組提交
    const commitsByDate = new Map<string, number[]>() // date -> minutes from midnight

    for (const commit of commits) {
      const date = new Date(commit.timestamp * 1000)
      const dateStr = this.formatDate(date)
      const minutesFromMidnight = date.getHours() * 60 + date.getMinutes()

      if (!commitsByDate.has(dateStr)) {
        commitsByDate.set(dateStr, [])
      }
      commitsByDate.get(dateStr)!.push(minutesFromMidnight)
    }

    // 計算每日工作跨度
    const dailySpans: DailyWorkSpan[] = []

    for (const [date, minutes] of commitsByDate.entries()) {
      if (minutes.length === 0) continue

      // 排序以找到最早和最晚的提交
      minutes.sort((a, b) => a - b)

      const firstCommitMinutes = minutes[0]
      const lastCommitMinutes = minutes[minutes.length - 1]

      // 計算工作跨度（小時）
      const spanMinutes = lastCommitMinutes - firstCommitMinutes
      const spanHours = spanMinutes / 60

      dailySpans.push({
        date,
        firstCommitMinutes,
        lastCommitMinutes,
        spanHours,
        commitCount: minutes.length,
      })
    }

    // 按日期排序
    dailySpans.sort((a, b) => a.date.localeCompare(b.date))

    return dailySpans
  }

  /**
   * 計算工作跨度的平均值
   * @param spans 工作跨度陣列
   * @returns 平均工作跨度（小時）
   */
  static calculateAverage(spans: DailyWorkSpan[]): number {
    if (spans.length === 0) return 0

    const total = spans.reduce((sum, span) => sum + span.spanHours, 0)
    return total / spans.length
  }

  /**
   * 計算工作跨度的標準差
   * @param spans 工作跨度陣列
   * @returns 標準差（小時）
   */
  static calculateStdDev(spans: DailyWorkSpan[]): number {
    if (spans.length === 0) return 0
    if (spans.length === 1) return 0

    const avg = this.calculateAverage(spans)
    const squaredDiffs = spans.map((span) => Math.pow(span.spanHours - avg, 2))
    const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / spans.length

    return Math.sqrt(variance)
  }

  /**
   * 獲取平均開始工作時間
   * 支援中國調休制度：只統計實際工作日
   * @param spans 工作跨度陣列
   * @param enableHolidayMode 是否啟用節假日調休模式
   * @returns 平均開始工作時間 (HH:mm)
   */
  static async getAverageStartTime(spans: DailyWorkSpan[], enableHolidayMode: boolean = true): Promise<string> {
    if (spans.length === 0) return '--:--'

    try {
      const checker = getWorkdayChecker(enableHolidayMode)
      const dates = spans.map((span) => span.date)
      const isWorkdayResults = await checker.isWorkdayBatch(dates)

      // 使用與 getAverageEndTime 相同的過濾逻辑
      const validSpans = spans.filter((span, index) => {
        return (
          isWorkdayResults[index] && // 工作日（考慮調休）
          span.spanHours >= 4 && // 跨度≥4小時
          span.lastCommitMinutes >= 15 * 60 // 15:00後結束
        )
      })

      const dataToUse = validSpans.length > 0 ? validSpans : spans

      const totalMinutes = dataToUse.reduce((sum, span) => sum + span.firstCommitMinutes, 0)
      const avgMinutes = Math.round(totalMinutes / dataToUse.length)
      return this.formatTime(avgMinutes)
    } catch (error) {
      // 回退到基础判斷
      return this.getAverageStartTimeBasic(spans)
    }
  }

  /**
   * 基础的平均開始工作時間計算（不考慮調休）
   */
  private static getAverageStartTimeBasic(spans: DailyWorkSpan[]): string {
    if (spans.length === 0) return '--:--'

    const validSpans = spans.filter((span) => {
      const date = new Date(`${span.date}T00:00:00`)
      const dayOfWeek = date.getDay()

      return (
        dayOfWeek >= 1 &&
        dayOfWeek <= 5 && // 工作日（基础判斷）
        span.spanHours >= 4 &&
        span.lastCommitMinutes >= 15 * 60
      )
    })

    const dataToUse = validSpans.length > 0 ? validSpans : spans
    const totalMinutes = dataToUse.reduce((sum, span) => sum + span.firstCommitMinutes, 0)
    const avgMinutes = Math.round(totalMinutes / dataToUse.length)
    return this.formatTime(avgMinutes)
  }

  /**
   * 獲取平均結束工作時間
   * 支援中國調休制度：只統計實際工作日
   * @param spans 工作跨度陣列
   * @param enableHolidayMode 是否啟用節假日調休模式
   * @returns 平均結束工作時間 (HH:mm)
   */
  static async getAverageEndTime(spans: DailyWorkSpan[], enableHolidayMode: boolean = true): Promise<string> {
    if (spans.length === 0) return '--:--'

    try {
      const checker = getWorkdayChecker(enableHolidayMode)
      const dates = spans.map((span) => span.date)
      const isWorkdayResults = await checker.isWorkdayBatch(dates)

      // 過濾條件：只統計正常工作日
      const validSpans = spans.filter((span, index) => {
        // 1. 排除非工作日（週末和法定節假日，考慮調休）
        if (!isWorkdayResults[index]) {
          return false
        }

        // 2. 排除工作跨度過短的異常天（<4小時）
        if (span.spanHours < 4) {
          return false
        }

        // 3. 排除過早結束的天（15:00之前結束）
        if (span.lastCommitMinutes < 15 * 60) {
          return false
        }

        return true
      })

      // 如果過濾後沒有有效資料，降级使用所有資料
      const dataToUse = validSpans.length > 0 ? validSpans : spans

      const totalMinutes = dataToUse.reduce((sum, span) => sum + span.lastCommitMinutes, 0)
      const avgMinutes = Math.round(totalMinutes / dataToUse.length)
      return this.formatTime(avgMinutes)
    } catch (error) {
      // 回退到基础判斷
      return this.getAverageEndTimeBasic(spans)
    }
  }

  /**
   * 基础的平均結束工作時間計算（不考慮調休）
   */
  private static getAverageEndTimeBasic(spans: DailyWorkSpan[]): string {
    if (spans.length === 0) return '--:--'

    const validSpans = spans.filter((span) => {
      const date = new Date(`${span.date}T00:00:00`)
      const dayOfWeek = date.getDay()

      if (dayOfWeek === 0 || dayOfWeek === 6) {
        return false
      }

      if (span.spanHours < 4) {
        return false
      }

      if (span.lastCommitMinutes < 15 * 60) {
        return false
      }

      return true
    })

    const dataToUse = validSpans.length > 0 ? validSpans : spans
    const totalMinutes = dataToUse.reduce((sum, span) => sum + span.lastCommitMinutes, 0)
    const avgMinutes = Math.round(totalMinutes / dataToUse.length)
    return this.formatTime(avgMinutes)
  }

  /**
   * 獲取最晚的提交時間
   * @param spans 工作跨度陣列
   * @returns 最晚提交時間 (HH:mm)
   */
  static getLatestEndTime(spans: DailyWorkSpan[]): string {
    if (spans.length === 0) return '--:--'

    const latestMinutes = Math.max(...spans.map((span) => span.lastCommitMinutes))
    return this.formatTime(latestMinutes)
  }

  /**
   * 格式化日期為 YYYY-MM-DD
   */
  private static formatDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  /**
   * 格式化分鐘數為 HH:mm
   * 注意：支援超過24小時的分鐘數（用於表示次日凌晨）
   */
  private static formatTime(minutes: number): string {
    // 如果超過24小時，說明是次日凌晨，轉換回0-24範圍並標注
    let displayMinutes = minutes
    let nextDay = false

    if (minutes >= 24 * 60) {
      displayMinutes = minutes - 24 * 60
      nextDay = true
    }

    const hours = Math.floor(displayMinutes / 60)
    const mins = displayMinutes % 60
    const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`

    // 如果是次日凌晨，添加標記
    return nextDay ? `${timeStr}+1` : timeStr
  }
}
