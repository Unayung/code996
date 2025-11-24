import { GitLogData, TimezoneData } from '../types/git-types'
import chalk from 'chalk'

/**
 * 按時區過濾 Git 資料
 * 注意：這是後處理近似過濾，精度有限
 */
export class TimezoneFilter {
  /**
   * 驗證時區格式
   * @param timezone 時區字符串，如 "+0800", "-0700"
   */
  static isValidTimezone(timezone: string): boolean {
    return /^[+-]\d{4}$/.test(timezone)
  }

  /**
   * 按指定時區過濾資料
   * @param rawData 原始 Git 資料
   * @param targetTimezone 目標時區，如 "+0800"
   * @returns 過濾後的資料和元資訊
   */
  static filterByTimezone(
    rawData: GitLogData,
    targetTimezone: string
  ): {
    filteredData: GitLogData
    ratio: number
    originalCommits: number
    filteredCommits: number
    warning: string
  } {
    // 驗證時區格式
    if (!this.isValidTimezone(targetTimezone)) {
      throw new Error(`無效的時區格式: ${targetTimezone}，正確格式為 +HHMM 或 -HHMM（例如: +0800, -0700）`)
    }

    // 檢查時區資料是否存在
    if (!rawData.timezoneData || rawData.timezoneData.totalCommits === 0) {
      throw new Error('無法按時區過濾：時區資料不可用')
    }

    const timezoneData = rawData.timezoneData

    // 查找目標時區
    const targetTzData = timezoneData.timezones.find((tz) => tz.offset === targetTimezone)

    if (!targetTzData) {
      // 列出可用時區
      const availableTimezones = timezoneData.timezones
        .slice(0, 5)
        .map((tz) => `${tz.offset} (${((tz.count / timezoneData.totalCommits) * 100).toFixed(1)}%)`)
        .join(', ')

      throw new Error(
        `時區 ${targetTimezone} 在資料中不存在。可用時區: ${availableTimezones}${timezoneData.timezones.length > 5 ? '...' : ''}`
      )
    }

    // 計算目標時區占比
    const ratio = targetTzData.count / timezoneData.totalCommits
    const filteredCommits = targetTzData.count

    // 按占比縮放資料（後處理近似過濾）
    // 使用精確縮放確保總和一致
    const scaleArray = (items: Array<{ time: string; count: number }>): Array<{ time: string; count: number }> => {
      // 第一遍：按比例縮放並向下取整
      const scaled = items.map((item) => ({
        ...item,
        count: Math.floor(item.count * ratio),
        remainder: (item.count * ratio) % 1,
      }))

      // 計算差值
      const currentSum = scaled.reduce((sum, item) => sum + item.count, 0)
      let diff = filteredCommits - currentSum

      // 按餘數大小排序，將差值分配給餘數最大的項
      const sortedByRemainder = [...scaled].sort((a, b) => b.remainder - a.remainder)

      for (let i = 0; i < diff && i < sortedByRemainder.length; i++) {
        const item = sortedByRemainder[i]
        const index = scaled.findIndex((x) => x.time === item.time)
        if (index !== -1) {
          scaled[index].count++
        }
      }

      return scaled.map(({ time, count }) => ({ time, count }))
    }

    const filteredData: GitLogData = {
      ...rawData,
      totalCommits: filteredCommits,
      byHour: scaleArray(rawData.byHour),
      byDay: scaleArray(rawData.byDay),
      // 以下字段無法精確過濾，保持原樣
      dailyFirstCommits: rawData.dailyFirstCommits,
      dayHourCommits: rawData.dayHourCommits
        ? scaleArray(
            rawData.dayHourCommits.map((item) => ({ time: `${item.weekday}-${item.hour}`, count: item.count }))
          ).map((item) => {
            const [weekday, hour] = item.time.split('-').map(Number)
            return { weekday, hour, count: item.count }
          })
        : undefined,
      dailyLatestCommits: rawData.dailyLatestCommits,
      dailyCommitHours: rawData.dailyCommitHours,
      contributors: rawData.contributors ? Math.max(1, Math.round(rawData.contributors * ratio)) : undefined,
    }

    // 生成警告資訊
    const warning = this.generateFilterWarning(targetTimezone, ratio, timezoneData.totalCommits, filteredCommits)

    return {
      filteredData,
      ratio,
      originalCommits: timezoneData.totalCommits,
      filteredCommits,
      warning,
    }
  }

  /**
   * 生成過濾警告資訊
   */
  private static generateFilterWarning(
    timezone: string,
    ratio: number,
    originalCommits: number,
    filteredCommits: number
  ): string {
    const lines: string[] = []

    lines.push(chalk.blue('⚙️  時區過濾已啟用'))
    lines.push('')
    lines.push(chalk.gray(`目標時區: ${timezone}`))
    lines.push(chalk.gray(`時區占比: ${(ratio * 100).toFixed(1)}%`))
    lines.push(chalk.gray(`原始提交: ${originalCommits} → 過濾後: ${filteredCommits}`))
    lines.push('')
    lines.push(chalk.yellow('⚠️  注意: 目前使用後處理近似過濾，以下資料可能不夠精確:'))
    lines.push(chalk.gray('  • 每日首次/最晚提交時間'))
    lines.push(chalk.gray('  • 工作時間推測'))
    lines.push(chalk.gray('  • 部分統計維度'))
    lines.push('')
    lines.push(chalk.gray('💡 建議: 結合 --author 參數獲得更精確的結果'))

    return lines.join('\n')
  }

  /**
   * 獲取可用時區列表（用於提示）
   */
  static getAvailableTimezones(timezoneData: TimezoneData, limit: number = 5): string[] {
    return timezoneData.timezones.slice(0, limit).map((tz) => {
      const ratio = ((tz.count / timezoneData.totalCommits) * 100).toFixed(1)
      return `${tz.offset} (${ratio}%, ${tz.count} commits)`
    })
  }
}
