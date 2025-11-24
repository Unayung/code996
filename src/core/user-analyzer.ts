import {
  UserWorkPattern,
  TeamAnalysis,
  WorkIntensityLevel,
  TimeCount,
  WorkTimePl,
  WorkWeekPl,
} from '../types/git-types'
import { UserPatternData } from '../git/collectors/user-pattern-collector'
import { WorkTimeAnalyzer } from './work-time-analyzer'
import { calculatePercentile } from '../utils/statistics'
import { calculate996Index } from './calculator'

/**
 * 使用者分析器
 * 負責對每個使用者進行獨立的工作時間分析和996指數計算，
 * 並在團隊層面進行統計和聚類分析
 */
export class UserAnalyzer {
  /**
   * 分析單個使用者的工作模式
   * @param baselineEndHour 團隊基準下班時間（可選，用於分類）
   */
  static analyzeUser(userData: UserPatternData, totalCommits: number, baselineEndHour?: number): UserWorkPattern {
    const { contributor, timeDistribution, dayDistribution, dailyFirstCommits, dailyLatestCommits } = userData

    // 計算工作時間（傳入空陣列作為dailyFirstCommits，因為我們沒有單個使用者的每日首提資料）
    const workingHours = WorkTimeAnalyzer.detectWorkingHours(timeDistribution, [])

    // 計算基於每日首末commit的平均上下班時間
    const avgTimes = this.calculateAverageWorkTimes(dailyFirstCommits, dailyLatestCommits)

    // 建構工作時間資料用於996指數計算（使用真實的星期分布）
    const workTimeData = this.buildWorkTimeData(
      timeDistribution,
      dayDistribution,
      workingHours.startHour,
      workingHours.endHour
    )

    // 計算996指數
    const result996 = calculate996Index(workTimeData)

    // 計算加班統計（簡化版）
    const overtimeStats = this.calculateOvertimeStats(timeDistribution, workingHours.startHour, workingHours.endHour)

    // 判斷工作強度等級（使用基準下班時間，如果沒有則使用預設值18）
    const intensityLevel = this.classifyIntensityLevel(workingHours.endHour, baselineEndHour)

    return {
      author: contributor.author,
      email: contributor.email,
      totalCommits: contributor.commits,
      commitPercentage: (contributor.commits / totalCommits) * 100,
      timeDistribution,
      workingHours,
      ...avgTimes, // 包含 avgStartTimeMedian, avgEndTimeMedian, validDays
      index996: result996.index996,
      overtimeStats,
      intensityLevel,
    }
  }

  /**
   * 計算使用者的平均上下班時間（中位數）
   * 要求：至少10天或20次有效資料
   */
  private static calculateAverageWorkTimes(
    dailyFirstCommits: Array<{ minutesFromMidnight: number }>,
    dailyLatestCommits: Array<{ minutesFromMidnight: number }>
  ): {
    avgStartTimeMedian?: number
    avgEndTimeMedian?: number
    validDays?: number
  } {
    // 檢查是否有足夠的資料（至少10天或20次）
    const minDays = 10
    const minCommits = 20

    const hasEnoughStartData = dailyFirstCommits.length >= minDays || dailyFirstCommits.length >= minCommits
    const hasEnoughEndData = dailyLatestCommits.length >= minDays || dailyLatestCommits.length >= minCommits

    if (!hasEnoughStartData && !hasEnoughEndData) {
      return {}
    }

    const result: {
      avgStartTimeMedian?: number
      avgEndTimeMedian?: number
      validDays?: number
    } = {}

    // 計算上班時間（中位數）
    if (hasEnoughStartData) {
      const startMinutes = dailyFirstCommits.map((c) => c.minutesFromMidnight)
      result.avgStartTimeMedian = this.calculateMedian(startMinutes) / 60 // 轉換為小時
    }

    // 計算下班時間（中位數）
    if (hasEnoughEndData) {
      const endMinutes = dailyLatestCommits.map((c) => c.minutesFromMidnight)
      result.avgEndTimeMedian = this.calculateMedian(endMinutes) / 60
    }

    // 記錄有效天數（取較小值）
    result.validDays = Math.min(dailyFirstCommits.length, dailyLatestCommits.length)

    return result
  }

  /**
   * 計算中位數
   */
  private static calculateMedian(values: number[]): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2
    }
    return sorted[mid]
  }

  /**
   * 建構工作時間資料（用於996指數計算）
   */
  private static buildWorkTimeData(
    timeDistribution: TimeCount[],
    dayDistribution: TimeCount[],
    startHour: number,
    endHour: number
  ): { workHourPl: WorkTimePl; workWeekPl: WorkWeekPl; hourData: TimeCount[] } {
    // 統計正常工作時間和加班時間的提交數
    let normalWork = 0
    let overtime = 0

    for (const item of timeDistribution) {
      const hour = parseInt(item.time, 10)
      if (hour >= startHour && hour < endHour) {
        normalWork += item.count
      } else {
        overtime += item.count
      }
    }

    // 使用真實的星期分布資料
    // 週一到週五（1-5）為工作日，週六日（6-7）為週末
    let workdayCommits = 0
    let weekendCommits = 0

    for (const item of dayDistribution) {
      const day = parseInt(item.time, 10)
      if (day >= 1 && day <= 5) {
        workdayCommits += item.count
      } else if (day === 6 || day === 7) {
        weekendCommits += item.count
      }
    }

    const workHourPl: WorkTimePl = [
      { time: '工作', count: normalWork },
      { time: '加班', count: overtime },
    ]

    const workWeekPl: WorkWeekPl = [
      { time: '工作日', count: workdayCommits },
      { time: '週末', count: weekendCommits },
    ]

    return {
      workHourPl,
      workWeekPl,
      hourData: timeDistribution,
    }
  }

  /**
   * 計算加班統計（簡化版）
   */
  private static calculateOvertimeStats(timeDistribution: TimeCount[], startHour: number, endHour: number) {
    let totalOvertime = 0

    for (const item of timeDistribution) {
      const hour = parseInt(item.time, 10)
      if (hour < startHour || hour >= endHour) {
        totalOvertime += item.count
      }
    }

    // 簡化處理：假設加班中80%在工作日，20%在週末
    const workdayOvertime = Math.round(totalOvertime * 0.8)
    const weekendOvertime = totalOvertime - workdayOvertime

    return {
      workdayOvertime,
      weekendOvertime,
      totalOvertime,
    }
  }

  /**
   * 根據下班時間判斷工作強度等級
   * @param endHour 個人下班時間
   * @param baselineEndHour 團隊基準下班時間（預設18）
   */
  private static classifyIntensityLevel(endHour: number, baselineEndHour: number = 18): WorkIntensityLevel {
    // 動態計算分類閾值
    // normal: 基準時間之前
    // moderate: 基準時間到基準時間+2小時
    // heavy: 基準時間+2小時之後
    const normalThreshold = baselineEndHour
    const moderateThreshold = baselineEndHour + 2

    if (endHour < normalThreshold) return 'normal'
    if (endHour < moderateThreshold) return 'moderate'
    return 'heavy'
  }

  /**
   * 分析團隊工作模式
   */
  static analyzeTeam(
    userPatterns: UserWorkPattern[],
    filterThreshold: number,
    totalContributors: number,
    overallIndex: number
  ): TeamAnalysis {
    // 先計算團隊的基準下班時間（使用P50中位數）
    const endTimesForBaseline = userPatterns
      .filter((u) => u.workingHours && u.workingHours.endHour)
      .map((u) => u.workingHours!.endHour)
      .sort((a, b) => a - b)

    const baselineEndHour = endTimesForBaseline.length > 0 ? calculatePercentile(endTimesForBaseline, 50) : 18

    // 根據基準下班時間重新分類工作強度
    userPatterns.forEach((u) => {
      if (u.workingHours) {
        u.intensityLevel = this.classifyIntensityLevel(u.workingHours.endHour, baselineEndHour)
      }
    })

    // 按工作強度分類
    const distribution = {
      normal: userPatterns.filter((u) => u.intensityLevel === 'normal'),
      moderate: userPatterns.filter((u) => u.intensityLevel === 'moderate'),
      heavy: userPatterns.filter((u) => u.intensityLevel === 'heavy'),
    }

    // 統計分析
    const index996List = userPatterns.map((u) => u.index996 || 0).sort((a, b) => a - b)
    const statistics = {
      median996: calculatePercentile(index996List, 50),
      mean996: index996List.reduce((sum, val) => sum + val, 0) / index996List.length,
      range: [index996List[0], index996List[index996List.length - 1]] as [number, number],
      percentiles: {
        p25: calculatePercentile(index996List, 25),
        p50: calculatePercentile(index996List, 50),
        p75: calculatePercentile(index996List, 75),
        p90: calculatePercentile(index996List, 90),
      },
    }

    // 健康度評估
    const healthAssessment = this.assessTeamHealth(overallIndex, statistics.median996, distribution)

    return {
      coreContributors: userPatterns,
      totalAnalyzed: userPatterns.length,
      totalContributors,
      filterThreshold,
      baselineEndHour,
      distribution,
      statistics,
      healthAssessment,
    }
  }

  /**
   * 計算分位數
   */

  /**
   * 團隊健康度評估
   */
  private static assessTeamHealth(
    overallIndex: number,
    teamMedianIndex: number,
    distribution: TeamAnalysis['distribution']
  ): TeamAnalysis['healthAssessment'] {
    let conclusion = ''
    let warning: string | undefined

    const heavyCount = distribution.heavy.length
    const totalCount = distribution.normal.length + distribution.moderate.length + distribution.heavy.length

    if (teamMedianIndex < 40) {
      conclusion = '團隊整體節奏良好，工作生活平衡較好。'
    } else if (teamMedianIndex < 60) {
      conclusion = '團隊整體節奏尚可，存在一定加班情況。'
    } else if (teamMedianIndex < 80) {
      conclusion = '團隊加班較為普遍，建議關注成員健康。'
    } else {
      conclusion = '團隊加班強度較大，需要重點關注。'
    }

    // 檢查是否存在個別嚴重加班的情況
    if (heavyCount > 0 && heavyCount / totalCount < 0.3) {
      const heavyRatio = ((heavyCount / totalCount) * 100).toFixed(0)
      warning = `檢測到 ${heavyCount} 名成員（${heavyRatio}%）存在嚴重加班情況，建議關注個別成員負荷。`
    }

    // 檢查整體指數和中位數的差異
    const indexGap = overallIndex - teamMedianIndex
    if (indexGap > 20) {
      if (warning) {
        warning += ` 專案整體指數（${overallIndex.toFixed(0)}）明顯高于團隊中位數（${teamMedianIndex.toFixed(0)}），可能存在個別"卷王"拉高整體資料。`
      } else {
        warning = `專案整體指數（${overallIndex.toFixed(0)}）明顯高于團隊中位數（${teamMedianIndex.toFixed(0)}），可能存在個別"卷王"拉高整體資料。`
      }
    }

    return {
      overallIndex,
      teamMedianIndex,
      conclusion,
      warning,
    }
  }
}
