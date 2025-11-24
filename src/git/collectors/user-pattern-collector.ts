import { GitLogOptions, TimeCount } from '../../types/git-types'
import { BaseCollector } from './base-collector'

/**
 * 貢獻者資訊（用於過濾和排序）
 */
export interface ContributorInfo {
  author: string // 作者名 "Name <email>"
  email: string // 郵箱
  name: string // 姓名
  commits: number // 提交數
}

/**
 * 每日首次/末次提交記錄
 */
export interface DailyCommitTime {
  date: string // YYYY-MM-DD
  minutesFromMidnight: number // 距離午夜的分鐘數
}

/**
 * 使用者工作模式資料（單個使用者的原始採集資料）
 */
export interface UserPatternData {
  contributor: ContributorInfo
  timeDistribution: TimeCount[] // 時間分布（24小時）
  dayDistribution: TimeCount[] // 星期分布（1-7）
  dailyFirstCommits: DailyCommitTime[] // 每日首次提交時間（過濾後）
  dailyLatestCommits: DailyCommitTime[] // 每日末次提交時間（過濾後）
}

/**
 * 使用者工作模式採集器
 * 負責為每個核心貢獻者單獨採集時間分布資料
 */
export class UserPatternCollector extends BaseCollector {
  /**
   * 獲取所有貢獻者列表及其提交數
   */
  async getAllContributors(options: GitLogOptions): Promise<ContributorInfo[]> {
    const { path } = options

    // 格式: "Author Name <email@example.com>|ISO_TIMESTAMP"
    const args = ['log', '--format=%an <%ae>|%ai']
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    const lines = output.split('\n').filter((line) => line.trim())

    // 統計每個作者的提交數
    const authorCommits = new Map<string, number>()
    const authorInfoMap = new Map<string, { name: string; email: string }>()

    for (const line of lines) {
      const parts = line.split('|')
      if (parts.length < 2) {
        continue
      }

      const author = parts[0]
      const isoTimestamp = parts[1]

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

      // 提取姓名和郵箱
      const match = author.match(/^(.+?)\s*<(.+?)>$/)
      if (match) {
        const name = match[1].trim()
        const email = match[2].trim()

        // 使用郵箱作為唯一標識
        authorCommits.set(email, (authorCommits.get(email) || 0) + 1)
        if (!authorInfoMap.has(email)) {
          authorInfoMap.set(email, { name, email })
        }
      }
    }

    // 轉換為ContributorInfo陣列
    const contributors: ContributorInfo[] = []
    for (const [email, commits] of authorCommits.entries()) {
      const info = authorInfoMap.get(email)
      if (info) {
        contributors.push({
          author: `${info.name} <${email}>`,
          email,
          name: info.name,
          commits,
        })
      }
    }

    // 按提交數降序排序
    contributors.sort((a, b) => b.commits - a.commits)

    return contributors
  }

  /**
   * 過濾核心貢獻者
   * @param contributors 所有貢獻者列表
   * @param minCommits 最小提交數（預設20）
   * @param maxUsers 最大使用者數（預設30）
   */
  filterCoreContributors(
    contributors: ContributorInfo[],
    minCommits: number = 20,
    maxUsers: number = 30
  ): ContributorInfo[] {
    return contributors.filter((c) => c.commits >= minCommits).slice(0, maxUsers)
  }

  /**
   * 為單個使用者採集時間分布資料（24小時粒度）
   */
  async getUserTimeDistribution(email: string, options: GitLogOptions): Promise<TimeCount[]> {
    const { path } = options

    // 使用 --author 參數過濾特定使用者
    // 格式: "HH:MM|ISO_TIMESTAMP"
    const args = ['log', '--format=%cd|%ai', `--date=format-local:%H:%M`, `--author=${email}`]
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    const lines = output.split('\n').filter((line) => line.trim())

    // 統計24小時分布（聚合到小時）
    const hourCounts = new Map<number, number>()

    for (const line of lines) {
      const parts = line.split('|')
      if (parts.length < 2) {
        continue
      }

      const time = parts[0]
      const isoTimestamp = parts[1]

      // 時區過濾
      if (options.timezone) {
        const timezoneMatch = isoTimestamp.match(/([+-]\d{4})$/)
        if (!timezoneMatch || timezoneMatch[1] !== options.timezone) {
          continue
        }
      }

      const match = time.trim().match(/^(\d{2}):(\d{2})$/)
      if (match) {
        const hour = parseInt(match[1], 10)
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1)
      }
    }

    // 轉換為TimeCount陣列（補全24小時）
    const timeDistribution: TimeCount[] = []
    for (let hour = 0; hour < 24; hour++) {
      timeDistribution.push({
        time: hour.toString().padStart(2, '0'),
        count: hourCounts.get(hour) || 0,
      })
    }

    return timeDistribution
  }

  /**
   * 為單個使用者採集星期分布資料
   */
  async getUserDayDistribution(email: string, options: GitLogOptions): Promise<TimeCount[]> {
    const { path } = options

    // 使用 --author 參數過濾特定使用者
    // 格式: "D|ISO_TIMESTAMP" (0-6, 週日到週六)
    const args = ['log', '--format=%cd|%ai', `--date=format-local:%w`, `--author=${email}`]
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    const lines = output.split('\n').filter((line) => line.trim())

    // 統計星期分布
    const dayCounts = new Map<number, number>()

    for (const line of lines) {
      const parts = line.split('|')
      if (parts.length < 2) {
        continue
      }

      const dayStr = parts[0]
      const isoTimestamp = parts[1]

      // 時區過濾
      if (options.timezone) {
        const timezoneMatch = isoTimestamp.match(/([+-]\d{4})$/)
        if (!timezoneMatch || timezoneMatch[1] !== options.timezone) {
          continue
        }
      }

      const dayW = parseInt(dayStr.trim(), 10)
      if (dayW >= 0 && dayW <= 6) {
        // 轉換：%w 的 0(週日) -> 7, 1-6 -> 1-6
        const day = dayW === 0 ? 7 : dayW
        dayCounts.set(day, (dayCounts.get(day) || 0) + 1)
      }
    }

    // 轉換為TimeCount陣列（補全7天）
    const dayDistribution: TimeCount[] = []
    for (let day = 1; day <= 7; day++) {
      dayDistribution.push({
        time: day.toString(),
        count: dayCounts.get(day) || 0,
      })
    }

    return dayDistribution
  }

  /**
   * 為單個使用者採集每日首次提交時間
   * - 僅工作日（週一到週五）
   * - 上班時間範圍：08:00-12:00
   * @param monthsBack 時間視窗（月數），預設6個月
   */
  async getUserDailyFirstCommits(email: string, options: GitLogOptions, monthsBack: number = 6): Promise<DailyCommitTime[]> {
    const { path } = options

    // 計算N個月前的日期
    const nMonthsAgo = new Date()
    nMonthsAgo.setMonth(nMonthsAgo.getMonth() - monthsBack)
    const sinceDate = nMonthsAgo.toISOString().split('T')[0]

    // 格式: "YYYY-MM-DD HH:MM|ISO_TIMESTAMP"
    const args = ['log', '--format=%cd|%ai', `--date=format-local:%Y-%m-%d %H:%M`, `--author=${email}`, `--since=${sinceDate}`]
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    const lines = output.split('\n').filter((line) => line.trim())

    // 按日期分組
    const dailyCommits = new Map<string, number[]>()

    for (const line of lines) {
      const parts = line.split('|')
      if (parts.length < 2) {
        continue
      }

      const timestamp = parts[0]
      const isoTimestamp = parts[1]

      // 時區過濾
      if (options.timezone) {
        const timezoneMatch = isoTimestamp.match(/([+-]\d{4})$/)
        if (!timezoneMatch || timezoneMatch[1] !== options.timezone) {
          continue
        }
      }

      const match = timestamp.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/)
      if (match) {
        const year = parseInt(match[1], 10)
        const month = parseInt(match[2], 10)
        const day = parseInt(match[3], 10)
        const hour = parseInt(match[4], 10)
        const minute = parseInt(match[5], 10)

        const date = `${match[1]}-${match[2]}-${match[3]}`

        // 計算星期幾（0=週日, 1=週一, ..., 6=週六）
        const dateObj = new Date(year, month - 1, day)
        const dayOfWeek = dateObj.getDay()

        // 排除週末（0=週日，6=週六）
        if (dayOfWeek === 0 || dayOfWeek === 6) continue

        // 上班時間範圍：08:00-12:00
        if (hour < 8 || hour >= 12) continue

        const minutesFromMidnight = hour * 60 + minute

        if (!dailyCommits.has(date)) {
          dailyCommits.set(date, [])
        }
        dailyCommits.get(date)!.push(minutesFromMidnight)
      }
    }

    // 找每天的最早時間
    const result: DailyCommitTime[] = []
    for (const [date, minutes] of dailyCommits.entries()) {
      const minMinutes = Math.min(...minutes)
      result.push({ date, minutesFromMidnight: minMinutes })
    }

    return result
  }

  /**
   * 為單個使用者採集每日末次提交時間
   * - 僅工作日（週一到週五）
   * - 下班時間範圍：16:00-02:00（次日）
   * @param monthsBack 時間視窗（月數），預設6個月
   */
  async getUserDailyLatestCommits(email: string, options: GitLogOptions, monthsBack: number = 6): Promise<DailyCommitTime[]> {
    const { path } = options

    // 計算N個月前的日期
    const nMonthsAgo = new Date()
    nMonthsAgo.setMonth(nMonthsAgo.getMonth() - monthsBack)
    const sinceDate = nMonthsAgo.toISOString().split('T')[0]

    // 格式: "YYYY-MM-DD HH:MM|ISO_TIMESTAMP"
    const args = ['log', '--format=%cd|%ai', `--date=format-local:%Y-%m-%d %H:%M`, `--author=${email}`, `--since=${sinceDate}`]
    this.applyCommonFilters(args, options)

    const output = await this.execGitCommand(args, path)
    const lines = output.split('\n').filter((line) => line.trim())

    // 按日期分組
    const dailyCommits = new Map<string, number[]>()

    for (const line of lines) {
      const parts = line.split('|')
      if (parts.length < 2) {
        continue
      }

      const timestamp = parts[0]
      const isoTimestamp = parts[1]

      // 時區過濾
      if (options.timezone) {
        const timezoneMatch = isoTimestamp.match(/([+-]\d{4})$/)
        if (!timezoneMatch || timezoneMatch[1] !== options.timezone) {
          continue
        }
      }

      const match = timestamp.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/)
      if (match) {
        const year = parseInt(match[1], 10)
        const month = parseInt(match[2], 10)
        const day = parseInt(match[3], 10)
        const hour = parseInt(match[4], 10)
        const minute = parseInt(match[5], 10)

        const date = `${match[1]}-${match[2]}-${match[3]}`

        // 計算星期幾（0=週日, 1=週一, ..., 6=週六）
        const dateObj = new Date(year, month - 1, day)
        const dayOfWeek = dateObj.getDay()

        // 排除週末（0=週日，6=週六）
        if (dayOfWeek === 0 || dayOfWeek === 6) continue

        const minutesFromMidnight = hour * 60 + minute

        // 下班時間範圍：16:00-02:00（次日凌晨）
        // 16:00 = 960分鐘, 02:00 = 120分鐘
        if (!(minutesFromMidnight >= 960 || minutesFromMidnight <= 120)) continue

        if (!dailyCommits.has(date)) {
          dailyCommits.set(date, [])
        }
        dailyCommits.get(date)!.push(minutesFromMidnight)
      }
    }

    // 找每天的最晚時間
    const result: DailyCommitTime[] = []
    for (const [date, minutes] of dailyCommits.entries()) {
      const maxMinutes = Math.max(...minutes)
      result.push({ date, minutesFromMidnight: maxMinutes })
    }

    return result
  }

  /**
   * 批量採集多個使用者的工作模式資料
   * @param monthsBackForWorkPattern 團隊工作模式的時間視窗（預設6個月）
   */
  async collectUserPatterns(
    coreContributors: ContributorInfo[],
    options: GitLogOptions,
    monthsBackForWorkPattern: number = 6
  ): Promise<UserPatternData[]> {
    const results: UserPatternData[] = []

    for (const contributor of coreContributors) {
      const [timeDistribution, dayDistribution, dailyFirstCommits, dailyLatestCommits] = await Promise.all([
        this.getUserTimeDistribution(contributor.email, options),
        this.getUserDayDistribution(contributor.email, options),
        this.getUserDailyFirstCommits(contributor.email, options, monthsBackForWorkPattern),
        this.getUserDailyLatestCommits(contributor.email, options, monthsBackForWorkPattern),
      ])

      results.push({
        contributor,
        timeDistribution,
        dayDistribution,
        dailyFirstCommits,
        dailyLatestCommits,
      })
    }

    return results
  }
}

