import {
  DayHourCommit,
  WeekdayOvertimeDistribution,
  WeekendOvertimeDistribution,
  LateNightAnalysis,
  WorkTimeDetectionResult,
  TimeCount,
  DailyFirstCommit,
  DailyLatestCommit,
  DailyCommitHours,
} from '../types/git-types'
import { getWorkdayChecker } from '../utils/workday-checker'

/**
 * 加班分析器
 * 負責分析工作日加班分布和深夜加班情況
 */
export class OvertimeAnalyzer {
  /**
   * 計算工作日加班分布（週一到週五的下班後提交數）
   * @param dayHourCommits 按星期幾和小時的提交資料
   * @param workTime 工作時間識別結果
   */
  static calculateWeekdayOvertime(
    dayHourCommits: DayHourCommit[],
    workTime: WorkTimeDetectionResult
  ): WeekdayOvertimeDistribution {
    const endHour = Math.ceil(workTime.endHour)

    // 初始化週一到週五的加班计數
    const overtimeCounts = {
      monday: 0,
      tuesday: 0,
      wednesday: 0,
      thursday: 0,
      friday: 0,
    }

    // 統計每個工作日下班後的提交數
    for (const commit of dayHourCommits) {
      const { weekday, hour, count } = commit

      // 只統計工作日（週一到週五：1-5）
      if (weekday >= 1 && weekday <= 5) {
        // 只統計下班時間之後的提交
        if (hour >= endHour) {
          const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const
          const dayIndex = weekday - 1
          overtimeCounts[dayNames[dayIndex]] += count
        }
      }
    }

    // 找出加班最多的一天
    const entries = Object.entries(overtimeCounts)
    const maxEntry = entries.reduce((max, curr) => (curr[1] > max[1] ? curr : max), entries[0])

    const dayNameMap: Record<string, string> = {
      monday: '週一',
      tuesday: '週二',
      wednesday: '週三',
      thursday: '週四',
      friday: '週五',
    }

    return {
      ...overtimeCounts,
      peakDay: dayNameMap[maxEntry[0]],
      peakCount: maxEntry[1],
    }
  }

  /**
   * 計算週末加班分布（基於每天的提交小時數區分真正加班和暫時修复）
   * 支援中國調休制度：只統計實際假期的加班，調休工作日不计入
   * @param dailyCommitHours 每日提交小時列表
   * @param enableHolidayMode 是否啟用節假日調休模式
   */
  static async calculateWeekendOvertime(
    dailyCommitHours: DailyCommitHours[],
    enableHolidayMode: boolean = true
  ): Promise<WeekendOvertimeDistribution> {
    // 定義閾值：提交時間跨度 >= 3 小時才算真正加班
    const REAL_OVERTIME_THRESHOLD = 3

    // 統計結果
    let saturdayDays = 0
    let sundayDays = 0
    let casualFixDays = 0
    let realOvertimeDays = 0

    try {
      const checker = getWorkdayChecker(enableHolidayMode)

      // 批量判斷所有日期是否為假期（考慮調休）
      const dates = dailyCommitHours.map((item) => item.date)
      const isHolidayResults = await checker.isHolidayBatch(dates)

      for (let i = 0; i < dailyCommitHours.length; i++) {
        const { date, hours } = dailyCommitHours[i]
        const isHoliday = isHolidayResults[i]

        // 只統計假期（包括週末和法定節假日，排除調休工作日）
        if (!isHoliday) {
          continue
        }

        const commitDate = new Date(date)
        const dayOfWeek = commitDate.getDay() // 0=Sunday, 6=Saturday
        const commitHours = hours.size

        // 根據提交的小時數判斷是否為真正加班
        const isRealOvertime = commitHours >= REAL_OVERTIME_THRESHOLD

        if (dayOfWeek === 6) {
          // 週六
          saturdayDays++
          if (isRealOvertime) {
            realOvertimeDays++
          } else {
            casualFixDays++
          }
        } else if (dayOfWeek === 0) {
          // 週日
          sundayDays++
          if (isRealOvertime) {
            realOvertimeDays++
          } else {
            casualFixDays++
          }
        } else {
          // 法定節假日（非週末）
          // 按照週六的逻辑處理
          saturdayDays++
          if (isRealOvertime) {
            realOvertimeDays++
          } else {
            casualFixDays++
          }
        }
      }
    } catch (error) {
      // 如果 holiday-calendar 查詢失敗，回退到基础判斷
      console.warn('使用 holiday-calendar 失敗，週末加班分析回退到基础判斷:', error)
      return this.calculateWeekendOvertimeBasic(dailyCommitHours)
    }

    return {
      saturdayDays,
      sundayDays,
      casualFixDays,
      realOvertimeDays,
    }
  }

  /**
   * 基础的週末加班分布計算（不考慮調休）
   * 當 holiday-calendar 不可用時使用
   */
  private static calculateWeekendOvertimeBasic(dailyCommitHours: DailyCommitHours[]): WeekendOvertimeDistribution {
    const REAL_OVERTIME_THRESHOLD = 3

    let saturdayDays = 0
    let sundayDays = 0
    let casualFixDays = 0
    let realOvertimeDays = 0

    for (const { date, hours } of dailyCommitHours) {
      const commitDate = new Date(date)
      const dayOfWeek = commitDate.getDay()

      // 只統計週末（基础判斷：週六、週日）
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        continue
      }

      const commitHours = hours.size
      const isRealOvertime = commitHours >= REAL_OVERTIME_THRESHOLD

      if (dayOfWeek === 6) {
        saturdayDays++
        if (isRealOvertime) {
          realOvertimeDays++
        } else {
          casualFixDays++
        }
      } else if (dayOfWeek === 0) {
        sundayDays++
        if (isRealOvertime) {
          realOvertimeDays++
        } else {
          casualFixDays++
        }
      }
    }

    return {
      saturdayDays,
      sundayDays,
      casualFixDays,
      realOvertimeDays,
    }
  }

  /**
   * 計算深夜加班分析（基於每天的最晚提交時間）
   * @param dailyLatestCommits 每日最晚提交時間
   * @param dailyFirstCommits 每日首次提交時間（用於統計工作日）
   * @param workTime 工作時間識別結果
   * @param since 開始日期
   * @param until 結束日期
   * @param enableHolidayMode 是否啟用節假日調休模式
   */
  static async calculateLateNightAnalysis(
    dailyLatestCommits: DailyLatestCommit[],
    dailyFirstCommits: DailyFirstCommit[],
    workTime: WorkTimeDetectionResult,
    since: string | undefined,
    until: string | undefined,
    enableHolidayMode: boolean = true
  ): Promise<LateNightAnalysis> {
    const endHour = Math.ceil(workTime.endHour)

    // 統計不同時段的天數（而不是提交數）
    let evening = 0 // 下班後-21:00
    let lateNight = 0 // 21:00-23:00
    let midnight = 0 // 23:00-02:00
    let dawn = 0 // 02:00-06:00

    // 統計有深夜/凌晨提交的天數
    const midnightDaysSet = new Set<string>()

    // 按照每天的最晚提交時間來統計
    for (const { date, minutesFromMidnight } of dailyLatestCommits) {
      const latestHour = Math.floor(minutesFromMidnight / 60)

      if (latestHour >= endHour && latestHour < 21) {
        evening++
      } else if (latestHour >= 21 && latestHour < 23) {
        lateNight++
      } else if (latestHour >= 23) {
        // 23:00-23:59 算作深夜
        midnight++
        midnightDaysSet.add(date)
      } else if (latestHour < 6) {
        // 00:00-05:59 算作凌晨
        // 注意：這裡 latestHour 是當天的最晚時間，如果是凌晨，說明工作到了第二天凌晨
        dawn++
        midnightDaysSet.add(date)
      }
    }

    // 從 dailyFirstCommits 統計總工作日天數
    // 使用 holiday-calendar 判斷工作日（考慮中國調休）
    const workDaysSet = new Set<string>()
    try {
      const checker = getWorkdayChecker(enableHolidayMode)
      const dates = dailyFirstCommits.map((c) => c.date)
      const isWorkdayResults = await checker.isWorkdayBatch(dates)

      for (let i = 0; i < dailyFirstCommits.length; i++) {
        if (isWorkdayResults[i]) {
          workDaysSet.add(dailyFirstCommits[i].date)
        }
      }
    } catch (error) {
      // 回退到基础判斷
      for (const commit of dailyFirstCommits) {
        const date = new Date(commit.date)
        const dayOfWeek = date.getDay()
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          workDaysSet.add(commit.date)
        }
      }
    }

    const midnightDays = midnightDaysSet.size
    const totalWorkDays = workDaysSet.size > 0 ? workDaysSet.size : 1 // 避免除以0
    const midnightRate = (midnightDays / totalWorkDays) * 100

    // 計算總週數和月數
    let totalWeeks = 0
    let totalMonths = 0

    if (since && until) {
      const sinceDate = new Date(since)
      const untilDate = new Date(until)
      const diffTime = Math.abs(untilDate.getTime() - sinceDate.getTime())
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

      totalWeeks = Math.max(1, Math.floor(diffDays / 7))
      totalMonths = Math.max(1, Math.floor(diffDays / 30))
    } else {
      // 如果沒有時間範圍，根據工作日天數估算
      totalWeeks = Math.max(1, Math.floor(totalWorkDays / 5))
      totalMonths = Math.max(1, Math.floor(totalWorkDays / 22))
    }

    return {
      evening,
      lateNight,
      midnight,
      dawn,
      midnightDays,
      totalWorkDays,
      midnightRate,
      totalWeeks,
      totalMonths,
    }
  }
}
