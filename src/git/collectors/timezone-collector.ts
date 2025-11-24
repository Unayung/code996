import { GitLogOptions, TimezoneData } from '../../types/git-types'
import { BaseCollector } from './base-collector'

/**
 * 時區資料採集器
 * 負責採集提交的時區偏移量分布
 */
export class TimezoneCollector extends BaseCollector {
  /**
   * 採集所有提交的時區偏移量
   * @returns 時區分布資料
   */
  async collectTimezones(options: GitLogOptions): Promise<TimezoneData> {
    const { path } = options

    // 採集時區偏移量：使用 %ai (author date ISO 8601) 格式
    // 格式示例: "2025-11-20 10:15:21 +0800"
    const args = ['log', '--format=%ai']
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    const lines = output.split('\n').filter((line) => line.trim())

    // 統計時區分布
    const timezoneMap = new Map<string, number>()

    for (const line of lines) {
      const timezone = this.extractTimezone(line)
      if (timezone && this.isValidTimezone(timezone)) {
        timezoneMap.set(timezone, (timezoneMap.get(timezone) || 0) + 1)
      }
    }

    // 轉換為陣列並按提交數降序排序
    const timezones = Array.from(timezoneMap.entries())
      .map(([offset, count]) => ({ offset, count }))
      .sort((a, b) => b.count - a.count)

    return {
      totalCommits: lines.length,
      timezones,
    }
  }

  /**
   * 從 ISO 8601 格式的日期字符串中提取時區
   * @param dateStr 格式: "2025-11-20 10:15:21 +0800"
   * @returns 時區偏移，如 "+0800", "-0700"
   */
  private extractTimezone(dateStr: string): string | null {
    // 匹配最後的時區偏移量：+HHMM 或 -HHMM
    const match = dateStr.match(/([+-]\d{4})$/)
    return match ? match[1] : null
  }

  /**
   * 驗證時區格式是否有效
   * @param timezone 時區字符串，如 "+0800", "-0700"
   */
  private isValidTimezone(timezone: string): boolean {
    // 時區格式：+HHMM 或 -HHMM
    return /^[+-]\d{4}$/.test(timezone)
  }
}
