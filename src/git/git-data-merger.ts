import {
  GitLogData,
  TimeCount,
  DailyFirstCommit,
  DailyLatestCommit,
  DayHourCommit,
  DailyCommitHours,
} from '../types/git-types'

/**
 * Git 資料合併器
 * 負責將多個儲存庫的 GitLogData 合併為一個統一的資料集
 */
export class GitDataMerger {
  /**
   * 合併多個儲存庫的 Git 資料
   * @param dataList 多個儲存庫的 GitLogData 陣列
   * @returns 合併後的 GitLogData
   */
  static merge(dataList: GitLogData[]): GitLogData {
    if (dataList.length === 0) {
      throw new Error('資料列表為空，無法合併')
    }

    if (dataList.length === 1) {
      return dataList[0]
    }

    return {
      byHour: this.mergeByHour(dataList),
      byDay: this.mergeByDay(dataList),
      totalCommits: this.mergeTotalCommits(dataList),
      dailyFirstCommits: this.mergeDailyFirstCommits(dataList),
      dayHourCommits: this.mergeDayHourCommits(dataList),
      dailyLatestCommits: this.mergeDailyLatestCommits(dataList),
      dailyCommitHours: this.mergeDailyCommitHours(dataList),
      granularity: 'half-hour', // 合併後保持半小時粒度
    }
  }

  /**
   * 合併按半小時統計的資料（48個半小時點）
   */
  private static mergeByHour(dataList: GitLogData[]): TimeCount[] {
    const halfHourMap = new Map<string, number>()

    // 初始化 48 個半小時點
    for (let i = 0; i < 24; i++) {
      const hour = i.toString().padStart(2, '0')
      halfHourMap.set(`${hour}:00`, 0)
      halfHourMap.set(`${hour}:30`, 0)
    }

    // 累加各儲存庫的資料
    for (const data of dataList) {
      for (const item of data.byHour) {
        const current = halfHourMap.get(item.time) || 0
        halfHourMap.set(item.time, current + item.count)
      }
    }

    // 轉換為陣列（保持順序）
    const result: TimeCount[] = []
    for (let i = 0; i < 24; i++) {
      const hour = i.toString().padStart(2, '0')
      result.push({
        time: `${hour}:00`,
        count: halfHourMap.get(`${hour}:00`) || 0,
      })
      result.push({
        time: `${hour}:30`,
        count: halfHourMap.get(`${hour}:30`) || 0,
      })
    }

    return result
  }

  /**
   * 合併按星期統計的資料（週一到週日）
   */
  private static mergeByDay(dataList: GitLogData[]): TimeCount[] {
    const dayMap = new Map<string, number>()

    // 初始化 7 天（1-7）
    for (let i = 1; i <= 7; i++) {
      dayMap.set(i.toString(), 0)
    }

    // 累加各儲存庫的資料
    for (const data of dataList) {
      for (const item of data.byDay) {
        const current = dayMap.get(item.time) || 0
        dayMap.set(item.time, current + item.count)
      }
    }

    // 轉換為陣列
    const result: TimeCount[] = []
    for (let i = 1; i <= 7; i++) {
      result.push({
        time: i.toString(),
        count: dayMap.get(i.toString()) || 0,
      })
    }

    return result
  }

  /**
   * 合併總提交數
   */
  private static mergeTotalCommits(dataList: GitLogData[]): number {
    return dataList.reduce((sum, data) => sum + data.totalCommits, 0)
  }

  /**
   * 合併每日首次提交時間
   * 策略：對於同一天，取所有儲存庫中最早的提交時間
   */
  private static mergeDailyFirstCommits(dataList: GitLogData[]): DailyFirstCommit[] | undefined {
    const dailyMap = new Map<string, number>()

    for (const data of dataList) {
      if (!data.dailyFirstCommits) {
        continue
      }

      for (const item of data.dailyFirstCommits) {
        const current = dailyMap.get(item.date)
        if (current === undefined || item.minutesFromMidnight < current) {
          dailyMap.set(item.date, item.minutesFromMidnight)
        }
      }
    }

    if (dailyMap.size === 0) {
      return undefined
    }

    return Array.from(dailyMap.entries())
      .map(([date, minutesFromMidnight]) => ({
        date,
        minutesFromMidnight,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  /**
   * 合併每日最晚提交時間
   * 策略：對於同一天，取所有儲存庫中最晚的提交時間
   */
  private static mergeDailyLatestCommits(dataList: GitLogData[]): DailyLatestCommit[] | undefined {
    const dailyMap = new Map<string, number>()

    for (const data of dataList) {
      if (!data.dailyLatestCommits) {
        continue
      }

      for (const item of data.dailyLatestCommits) {
        const current = dailyMap.get(item.date)
        if (current === undefined || item.minutesFromMidnight > current) {
          dailyMap.set(item.date, item.minutesFromMidnight)
        }
      }
    }

    if (dailyMap.size === 0) {
      return undefined
    }

    return Array.from(dailyMap.entries())
      .map(([date, minutesFromMidnight]) => ({
        date,
        minutesFromMidnight,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  /**
   * 合併按星期和小時的提交統計
   * 策略：累加相同 (weekday, hour) 組合的提交數
   */
  private static mergeDayHourCommits(dataList: GitLogData[]): DayHourCommit[] | undefined {
    const map = new Map<string, number>()

    for (const data of dataList) {
      if (!data.dayHourCommits) {
        continue
      }

      for (const item of data.dayHourCommits) {
        const key = `${item.weekday}-${item.hour}`
        const current = map.get(key) || 0
        map.set(key, current + item.count)
      }
    }

    if (map.size === 0) {
      return undefined
    }

    const result: DayHourCommit[] = []
    map.forEach((count, key) => {
      const [weekday, hour] = key.split('-').map((v) => parseInt(v, 10))
      result.push({ weekday, hour, count })
    })

    return result
  }

  /**
   * 合併每日提交小時列表
   * 策略：對於同一天，合併所有儲存庫的提交小時集合（取並集）
   */
  private static mergeDailyCommitHours(dataList: GitLogData[]): DailyCommitHours[] | undefined {
    const dailyMap = new Map<string, Set<number>>()

    for (const data of dataList) {
      if (!data.dailyCommitHours) {
        continue
      }

      for (const item of data.dailyCommitHours) {
        if (!dailyMap.has(item.date)) {
          dailyMap.set(item.date, new Set())
        }
        const hoursSet = dailyMap.get(item.date)!
        item.hours.forEach((hour) => hoursSet.add(hour))
      }
    }

    if (dailyMap.size === 0) {
      return undefined
    }

    return Array.from(dailyMap.entries())
      .map(([date, hours]) => ({
        date,
        hours,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }
}
