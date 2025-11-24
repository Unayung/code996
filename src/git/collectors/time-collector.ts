import { GitLogOptions, TimeCount } from '../../types/git-types'
import { BaseCollector } from './base-collector'

/**
 * 時間分布資料採集器
 * 負責按小時和按星期統計提交分布
 */
export class TimeCollector extends BaseCollector {
  /**
   * 按半小時統計commit資料（内部採集分鐘级，聚合為48個半小時点）
   */
  async getCommitsByHour(options: GitLogOptions): Promise<TimeCount[]> {
    const { path } = options

    // 採集分鐘级資料：同時獲取作者、本地時間和時區資訊用於過濾
    // 格式: "Author Name <email@example.com>|HH:MM|2025-01-01 12:30:00 +0800"
    const args = ['log', '--format=%an <%ae>|%cd|%ai', `--date=format-local:%H:%M`]
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    return this.parseTimeData(output, 'half-hour', options.ignoreAuthor, options.timezone)
  }

  /**
   * 按星期統計commit資料
   */
  async getCommitsByDay(options: GitLogOptions): Promise<TimeCount[]> {
    const { path } = options

    // 格式: "Author Name <email@example.com>|D|2025-01-01 12:30:00 +0800" (D為星期幾，0-6)
    const args = ['log', '--format=%an <%ae>|%cd|%ai', `--date=format-local:%w`]
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    return this.parseTimeData(output, 'day', options.ignoreAuthor, options.timezone)
  }

  /**
   * 解析時間資料（支援作者過濾和時區過濾）
   * @param output git log 輸出，格式: "Author Name <email@example.com>|TIME|ISO_TIMESTAMP"
   * @param type 時間類型
   * @param ignoreAuthor 排除作者的正則表達式
   * @param timezone 指定時區過濾（例如: +0800）
   */
  private parseTimeData(
    output: string,
    type: 'half-hour' | 'day',
    ignoreAuthor?: string,
    timezone?: string
  ): TimeCount[] {
    const lines = output.split('\n').filter((line) => line.trim())
    const timeCounts: TimeCount[] = []

    for (const line of lines) {
      const trimmedLine = line.trim()

      // 分离作者、時間和ISO時間戳：格式 "Author Name <email@example.com>|TIME|ISO_TIMESTAMP"
      const parts = trimmedLine.split('|')
      if (parts.length < 3) {
        continue // 格式不正確，跳過
      }

      const author = parts[0]
      let time = parts[1]
      const isoTimestamp = parts[2] // 例如: "2025-01-01 12:30:00 +0800"

      // 檢查是否應該排除此作者
      if (this.shouldIgnoreAuthor(author, ignoreAuthor)) {
        continue
      }

      // 時區過濾：從ISO時間戳中提取時區資訊
      if (timezone) {
        const timezoneMatch = isoTimestamp.match(/([+-]\d{4})$/)
        if (!timezoneMatch) {
          continue // 無法解析時區，跳過
        }
        const commitTimezone = timezoneMatch[1]
        if (commitTimezone !== timezone) {
          continue // 不匹配目標時區，跳過
        }
      }

      // 如果是半小時模式，需要將分鐘歸類到半小時
      if (type === 'half-hour' && time) {
        const match = time.match(/^(\d{2}):(\d{2})$/)
        if (match) {
          const hour = match[1]
          const minute = parseInt(match[2], 10)
          // 0-29分鐘歸到 :00，30-59分鐘歸到 :30
          time = minute < 30 ? `${hour}:00` : `${hour}:30`
        }
      }

      // 如果是星期模式，需要將 %w 格式(0-6)轉換為 1-7 格式
      if (type === 'day' && time) {
        const dayW = parseInt(time, 10)
        if (!isNaN(dayW) && dayW >= 0 && dayW <= 6) {
          // 轉換：%w 的 0(週日) -> 7, 1-6 -> 1-6
          time = (dayW === 0 ? 7 : dayW).toString()
        }
      }

      if (time) {
        // 查找是否已存在該時間点的计數
        const existingIndex = timeCounts.findIndex((item) => item.time === time)
        if (existingIndex >= 0) {
          timeCounts[existingIndex].count++
        } else {
          timeCounts.push({
            time,
            count: 1,
          })
        }
      }
    }

    // 確保所有時間点都有資料（補0）
    if (type === 'half-hour') {
      return this.fillMissingHalfHours(timeCounts)
    }

    return this.fillMissingDays(timeCounts)
  }

  /**
   * 補全缺失的半小時資料（48個時間点）
   */
  private fillMissingHalfHours(data: TimeCount[]): TimeCount[] {
    const halfHours: TimeCount[] = []

    for (let i = 0; i < 24; i++) {
      const hour = i.toString().padStart(2, '0')

      // 每小時兩個時間点：:00 和 :30
      for (const suffix of ['00', '30']) {
        const timeKey = `${hour}:${suffix}`
        const existing = data.find((item) => item.time === timeKey)

        halfHours.push({
          time: timeKey,
          count: existing ? existing.count : 0,
        })
      }
    }

    return halfHours
  }

  /**
   * 補全缺失的星期資料
   */
  private fillMissingDays(data: TimeCount[]): TimeCount[] {
    const days: TimeCount[] = []

    for (let i = 1; i <= 7; i++) {
      const day = i.toString()
      const existing = data.find((item) => item.time === day)

      days.push({
        time: day,
        count: existing ? existing.count : 0,
      })
    }

    return days
  }
}
