import {
  GitLogOptions,
  DailyFirstCommit,
  DayHourCommit,
  DailyLatestCommit,
  DailyCommitHours,
  DailyCommitCount,
} from '../../types/git-types'
import { BaseCollector } from './base-collector'

/**
 * 提交詳情資料採集器
 * 負責採集每日首末提交、按星期和小時的提交分布等
 */
export class CommitCollector extends BaseCollector {
  /**
   * 按星期幾和小時統計commit資料
   */
  async getCommitsByDayAndHour(options: GitLogOptions): Promise<DayHourCommit[]> {
    const { path } = options

    // 格式: "Author Name <email@example.com>|D H|ISO_TIMESTAMP" (D=星期幾 0-6，H=小時)
    const args = ['log', '--format=%an <%ae>|%cd|%ai', '--date=format-local:%w %H']
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    const lines = output.split('\n').filter((line) => line.trim())

    // 統計每個 weekday+hour 組合的提交數
    const commitMap = new Map<string, number>()

    for (const line of lines) {
      const trimmed = line.trim()

      // 分离作者、時間資料和ISO時間戳
      const parts = trimmed.split('|')
      if (parts.length < 3) {
        continue
      }

      const author = parts[0]
      const timeData = parts[1]
      const isoTimestamp = parts[2]

      // 檢查是否應該排除此作者
      if (this.shouldIgnoreAuthor(author, options.ignoreAuthor)) {
        continue
      }

      // 時區過濾
      if (options.timezone) {
        const timezoneMatch = isoTimestamp.match(/([+-]\d{4})$/)
        if (!timezoneMatch || timezoneMatch[1] !== options.timezone) {
          continue
        }
      }

      const timeParts = timeData.trim().split(/\s+/)

      if (timeParts.length >= 2) {
        const dayW = parseInt(timeParts[0], 10)
        const hour = parseInt(timeParts[1], 10)

        if (!isNaN(dayW) && !isNaN(hour) && dayW >= 0 && dayW <= 6 && hour >= 0 && hour <= 23) {
          // 轉換：%w 的 0(週日) -> 7, 1-6 -> 1-6
          const weekday = dayW === 0 ? 7 : dayW
          const key = `${weekday}-${hour}`
          commitMap.set(key, (commitMap.get(key) || 0) + 1)
        }
      }
    }

    // 轉換為陣列格式
    const result: DayHourCommit[] = []
    commitMap.forEach((count, key) => {
      const [weekday, hour] = key.split('-').map((v) => parseInt(v, 10))
      result.push({ weekday, hour, count })
    })

    return result
  }

  /**
   * 獲取每日最早的提交時間（分鐘數表示）
   */
  async getDailyFirstCommits(options: GitLogOptions): Promise<DailyFirstCommit[]> {
    const { path } = options

    // 格式: "Author Name <email@example.com>|YYYY-MM-DDTHH:MM:SS|ISO_TIMESTAMP"
    const args = ['log', '--format=%an <%ae>|%cd|%ai', '--date=format-local:%Y-%m-%dT%H:%M:%S']
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    const lines = output.split('\n').filter((line) => line.trim())

    const dailyEarliest = new Map<string, number>()

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }

      // 分离作者、時間和ISO時間戳
      const parts = trimmed.split('|')
      if (parts.length < 3) {
        continue
      }

      const author = parts[0]
      const timestamp = parts[1]
      const isoTimestamp = parts[2]

      // 檢查是否應該排除此作者
      if (this.shouldIgnoreAuthor(author, options.ignoreAuthor)) {
        continue
      }

      // 時區過濾
      if (options.timezone) {
        const timezoneMatch = isoTimestamp.match(/([+-]\d{4})$/)
        if (!timezoneMatch || timezoneMatch[1] !== options.timezone) {
          continue
        }
      }

      const parsed = this.parseLocalTimestamp(timestamp)
      if (!parsed) {
        continue
      }

      const minutesFromMidnight = parsed.hour * 60 + parsed.minute
      const current = dailyEarliest.get(parsed.dateKey)

      if (current === undefined || minutesFromMidnight < current) {
        dailyEarliest.set(parsed.dateKey, minutesFromMidnight)
      }
    }

    return Array.from(dailyEarliest.entries())
      .map(([date, minutesFromMidnight]) => ({
        date,
        minutesFromMidnight,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  /**
   * 獲取每日最晚的提交時間
   * 注意：凌晨0:00-6:00的提交會被歸入前一天，因為这通常是前一天工作的延續
   */
  async getDailyLatestCommits(options: GitLogOptions): Promise<DailyLatestCommit[]> {
    const { path } = options

    // 格式: "Author Name <email@example.com>|YYYY-MM-DDTHH:MM:SS|ISO_TIMESTAMP"
    const args = ['log', '--format=%an <%ae>|%cd|%ai', '--date=format-local:%Y-%m-%dT%H:%M:%S']
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    const lines = output.split('\n').filter((line) => line.trim())

    const dailyLatest = new Map<string, number>()

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }

      // 分离作者、時間和ISO時間戳
      const parts = trimmed.split('|')
      if (parts.length < 3) {
        continue
      }

      const author = parts[0]
      const timestamp = parts[1]
      const isoTimestamp = parts[2]

      // 檢查是否應該排除此作者
      if (this.shouldIgnoreAuthor(author, options.ignoreAuthor)) {
        continue
      }

      // 時區過濾
      if (options.timezone) {
        const timezoneMatch = isoTimestamp.match(/([+-]\d{4})$/)
        if (!timezoneMatch || timezoneMatch[1] !== options.timezone) {
          continue
        }
      }

      const parsed = this.parseLocalTimestamp(timestamp)
      if (!parsed) {
        continue
      }

      let effectiveDate = parsed.dateKey
      let effectiveMinutes = parsed.hour * 60 + parsed.minute

      // 如果是凌晨0:00-6:00的提交，歸入前一天
      // 這些提交通常是前一天加班的延續
      if (parsed.hour >= 0 && parsed.hour < 6) {
        const date = new Date(`${parsed.dateKey}T00:00:00`)
        date.setDate(date.getDate() - 1)
        effectiveDate = this.formatDateKey(date)
        // 分鐘數需要加24小時，表示次日凌晨
        effectiveMinutes = effectiveMinutes + 24 * 60
      }

      const current = dailyLatest.get(effectiveDate)

      // 保存最晚的分鐘數
      if (current === undefined || effectiveMinutes > current) {
        dailyLatest.set(effectiveDate, effectiveMinutes)
      }
    }

    return Array.from(dailyLatest.entries())
      .map(([date, minutesFromMidnight]) => ({
        date,
        minutesFromMidnight,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  /**
   * 格式化日期為 YYYY-MM-DD
   */
  private formatDateKey(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  /**
   * 獲取每日所有提交的小時列表
   */
  async getDailyCommitHours(options: GitLogOptions): Promise<DailyCommitHours[]> {
    const { path } = options

    // 格式: "Author Name <email@example.com>|YYYY-MM-DDTHH:MM:SS|ISO_TIMESTAMP"
    const args = ['log', '--format=%an <%ae>|%cd|%ai', '--date=format-local:%Y-%m-%dT%H:%M:%S']
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    const lines = output.split('\n').filter((line) => line.trim())

    const dailyHours = new Map<string, Set<number>>()

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }

      // 分离作者、時間和ISO時間戳
      const parts = trimmed.split('|')
      if (parts.length < 3) {
        continue
      }

      const author = parts[0]
      const timestamp = parts[1]
      const isoTimestamp = parts[2]

      // 檢查是否應該排除此作者
      if (this.shouldIgnoreAuthor(author, options.ignoreAuthor)) {
        continue
      }

      // 時區過濾
      if (options.timezone) {
        const timezoneMatch = isoTimestamp.match(/([+-]\d{4})$/)
        if (!timezoneMatch || timezoneMatch[1] !== options.timezone) {
          continue
        }
      }

      const parsed = this.parseLocalTimestamp(timestamp)
      if (!parsed) {
        continue
      }

      if (!dailyHours.has(parsed.dateKey)) {
        dailyHours.set(parsed.dateKey, new Set())
      }
      dailyHours.get(parsed.dateKey)!.add(parsed.hour)
    }

    return Array.from(dailyHours.entries())
      .map(([date, hours]) => ({
        date,
        hours,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  /**
   * 獲取每日提交數
   * @returns 每天的提交數列表（date: YYYY-MM-DD, count: 提交數）
   */
  async getDailyCommitCounts(options: GitLogOptions): Promise<DailyCommitCount[]> {
    const { path } = options

    // 格式: "Author Name <email@example.com>|YYYY-MM-DD|ISO_TIMESTAMP"
    const args = ['log', '--format=%an <%ae>|%cd|%ai', '--date=format-local:%Y-%m-%d']
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    const lines = output.split('\n').filter((line) => line.trim())

    const dailyCounts = new Map<string, number>()

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }

      // 分离作者、日期和ISO時間戳
      const parts = trimmed.split('|')
      if (parts.length < 3) {
        continue
      }

      const author = parts[0]
      const date = parts[1].trim()
      const isoTimestamp = parts[2]

      // 檢查是否應該排除此作者
      if (this.shouldIgnoreAuthor(author, options.ignoreAuthor)) {
        continue
      }

      // 時區過濾
      if (options.timezone) {
        const timezoneMatch = isoTimestamp.match(/([+-]\d{4})$/)
        if (!timezoneMatch || timezoneMatch[1] !== options.timezone) {
          continue
        }
      }

      // 驗證日期格式 (YYYY-MM-DD)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        continue
      }

      dailyCounts.set(date, (dailyCounts.get(date) || 0) + 1)
    }

    return Array.from(dailyCounts.entries())
      .map(([date, count]) => ({
        date,
        count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }
}
