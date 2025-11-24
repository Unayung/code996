import { GitLogData, ParsedGitData, TimeCount } from '../types/git-types'

/**
 * 專案類型枚举
 */
export enum ProjectType {
  CORPORATE = 'corporate', // 公司專案/正常工作專案
  OPEN_SOURCE = 'open_source', // 開源專案/業余專案
  UNCERTAIN = 'uncertain', // 不確定
}

/**
 * 專案分類結果
 */
export interface ProjectClassificationResult {
  projectType: ProjectType
  confidence: number // 置信度 (0-100)
  dimensions: {
    workTimeRegularity: {
      score: number // 規律性得分 (0-100)
      description: string
      details: {
        morningUptrend: boolean // 上午是否上升
        afternoonPeak: boolean // 下午是否是高峰
        eveningDowntrend: boolean // 晚上是否下降
        nightLowActivity: boolean // 深夜是否低活跃
      }
    }
    weekendActivity: {
      ratio: number // 週末活躍度 (0-1)
      description: string
    }
    moonlightingPattern: {
      isActive: boolean // 是否晚間活跃
      eveningToMorningRatio: number // 晚上/白天比率
      nightRatio: number // 晚間占比（晚上/總數）
      description: string
    }
    contributorsCount: {
      count: number // 貢獻者數量
      description: string // 描述
    }
  }
  reasoning: string // 判斷理由
}

/**
 * 專案分類器
 * 通過多個維度判斷專案是公司專案还是開源專案
 */
export class ProjectClassifier {
  /**
   * 分類專案
   * @param rawData 原始 Git 資料
   * @param parsedData 解析後的 Git 資料
   * @returns 分類結果
   */
  static classify(rawData: GitLogData, parsedData: ParsedGitData): ProjectClassificationResult {
    // 維度1: 工作時間規律性（最重要，可單独判定）
    const regularityResult = this.detectWorkTimeRegularity(rawData.byHour, rawData.byDay, rawData.dayHourCommits)

    // 維度2: 週末活躍度
    const weekendResult = this.detectWeekendActivity(parsedData.workWeekPl)

    // 維度3: 月光族模式
    const moonlightingResult = this.detectMoonlightingPattern(rawData.byHour, rawData.byDay, rawData.dayHourCommits)

    // 維度4: 貢獻者數量（強特征，可單独判定）
    const contributorsCount = rawData.contributors || 0

    // 综合判斷
    const { projectType, confidence, reasoning } = this.makeDecision(
      regularityResult,
      weekendResult,
      moonlightingResult,
      contributorsCount
    )

    return {
      projectType,
      confidence,
      dimensions: {
        workTimeRegularity: regularityResult,
        weekendActivity: weekendResult,
        moonlightingPattern: moonlightingResult,
        contributorsCount: {
          count: contributorsCount,
          description: this.getContributorsDescription(contributorsCount),
        },
      },
      reasoning,
    }
  }

  /**
   * 獲取貢獻者數量的描述
   */
  private static getContributorsDescription(count: number): string {
    if (count >= 100) return `${count} 人（大型開源專案）`
    if (count >= 50) return `${count} 人（中型開源專案）`
    if (count >= 20) return `${count} 人（小型開源專案）`
    if (count >= 10) return `${count} 人（小團隊）`
    return `${count} 人`
  }

  /**
   * 維度1: 檢測工作時間規律性
   * 公司專案的特征：週一到週五，上午逐渐增多，下午是高峰，晚上逐渐下降
   */
  private static detectWorkTimeRegularity(
    byHour: TimeCount[],
    byDay: TimeCount[],
    dayHourCommits?: any[]
  ): ProjectClassificationResult['dimensions']['workTimeRegularity'] {
    // 提取週一到週五的提交資料（使用 dayHourCommits 如果可用）
    const hourlyCommits = this.extractWorkdayHourlyData(byHour, byDay, dayHourCommits)
    if (hourlyCommits.length === 0 || hourlyCommits.every((c) => c === 0)) {
      return {
        score: 50,
        description: '資料不足',
        details: {
          morningUptrend: false,
          afternoonPeak: false,
          eveningDowntrend: false,
          nightLowActivity: false,
        },
      }
    }

    // 檢查各個時段的特征
    const morningUptrend = this.checkMorningUptrend(hourlyCommits) // 6:00-12:00 上升
    const afternoonPeak = this.checkAfternoonPeak(hourlyCommits) // 14:00-17:00 是高峰
    const eveningDowntrend = this.checkEveningDowntrend(hourlyCommits) // 18:00-22:00 下降
    const nightLowActivity = this.checkNightLowActivity(hourlyCommits) // 22:00-6:00 低活跃

    // 計算規律性得分（每項25分）
    let score = 0
    if (morningUptrend) score += 25
    if (afternoonPeak) score += 25
    if (eveningDowntrend) score += 25
    if (nightLowActivity) score += 25

    // 生成描述
    let description = ''
    if (score >= 75) {
      description = '高規律性（典型的公司工作模式）'
    } else if (score >= 50) {
      description = '中等規律性'
    } else if (score >= 25) {
      description = '低規律性（可能是開源專案）'
    } else {
      description = '無規律性（典型的開源專案）'
    }

    return {
      score,
      description,
      details: {
        morningUptrend,
        afternoonPeak,
        eveningDowntrend,
        nightLowActivity,
      },
    }
  }

  /**
   * 提取週一到週五的小時级提交資料（更精確的版本）
   * @param byHour 總的小時分布
   * @param byDay 星期分布
   * @param dayHourCommits 按星期和小時的詳細分布（如果可用）
   * @returns 24小時陣列，只包含工作日的提交
   */
  private static extractWorkdayHourlyData(
    byHour: TimeCount[],
    byDay: TimeCount[],
    dayHourCommits?: any[]
  ): number[] {
    // 如果有 dayHourCommits，使用精確資料
    if (dayHourCommits && dayHourCommits.length > 0) {
      const hourCounts = new Array(24).fill(0)

      for (const item of dayHourCommits) {
        const weekday = item.weekday // 1-7 (週一到週日)
        const hour = item.hour // 0-23
        const count = item.count

        // 只統計週一到週五（1-5）
        if (weekday >= 1 && weekday <= 5) {
          hourCounts[hour] += count
        }
      }

      return hourCounts
    }

    // 降级方案：計算工作日占比，按比例分配
    let workdayTotal = 0
    let totalCommits = 0

    for (const day of byDay) {
      const dayNum = parseInt(day.time, 10)
      totalCommits += day.count
      if (dayNum >= 1 && dayNum <= 5) {
        workdayTotal += day.count
      }
    }

    if (workdayTotal === 0 || totalCommits === 0) {
      return new Array(24).fill(0)
    }

    const workdayRatio = workdayTotal / totalCommits

    // 將 byHour 按工作日占比縮放
    const hourCounts = this.aggregateToHourArray(byHour)
    return hourCounts.map((count) => Math.round(count * workdayRatio))
  }

  /**
   * 將 TimeCount 陣列聚合為24小時陣列
   */
  private static aggregateToHourArray(hourData: TimeCount[]): number[] {
    const hourCounts = new Array(24).fill(0)

    for (const item of hourData) {
      // 解析時間字符串，支援 "HH" 或 "HH:MM" 格式
      const hour = parseInt(item.time.split(':')[0], 10)

      if (!isNaN(hour) && hour >= 0 && hour < 24) {
        hourCounts[hour] += item.count
      }
    }

    return hourCounts
  }

  /**
   * 檢查上午上升趨勢（6:00-12:00）
   */
  private static checkMorningUptrend(hourCounts: number[]): boolean {
    const morning = hourCounts.slice(6, 12) // 6:00-11:00
    if (morning.every((c) => c === 0)) return false

    // 檢查是否整體呈上升趨勢（後半段平均值 > 前半段平均值）
    const firstHalf = morning.slice(0, 3).reduce((sum, c) => sum + c, 0) / 3
    const secondHalf = morning.slice(3, 6).reduce((sum, c) => sum + c, 0) / 3

    return secondHalf > firstHalf * 1.2 // 後半段至少比前半段多20%
  }

  /**
   * 檢查下午高峰（14:00-17:00）
   */
  private static checkAfternoonPeak(hourCounts: number[]): boolean {
    const afternoon = hourCounts.slice(14, 18) // 14:00-17:00
    const morning = hourCounts.slice(9, 12) // 9:00-11:00
    const evening = hourCounts.slice(19, 22) // 19:00-21:00

    const afternoonAvg = afternoon.reduce((sum, c) => sum + c, 0) / afternoon.length
    const morningAvg = morning.reduce((sum, c) => sum + c, 0) / morning.length
    const eveningAvg = evening.reduce((sum, c) => sum + c, 0) / evening.length

    // 下午平均值應該是最高的
    return afternoonAvg > morningAvg && afternoonAvg > eveningAvg
  }

  /**
   * 檢查晚上下降趨勢（18:00-22:00）
   */
  private static checkEveningDowntrend(hourCounts: number[]): boolean {
    const evening = hourCounts.slice(18, 23) // 18:00-22:00
    if (evening.every((c) => c === 0)) return true // 晚上沒有提交也算符合

    // 檢查是否整體呈下降趨勢（前半段平均值 > 後半段平均值）
    const firstHalf = evening.slice(0, 3).reduce((sum, c) => sum + c, 0) / 3
    const secondHalf = evening.slice(3, 5).reduce((sum, c) => sum + c, 0) / 2

    return firstHalf > secondHalf || secondHalf < firstHalf * 1.5 // 沒有顯著上升
  }

  /**
   * 檢查深夜低活跃（22:00-6:00）
   */
  private static checkNightLowActivity(hourCounts: number[]): boolean {
    const night = [...hourCounts.slice(22, 24), ...hourCounts.slice(0, 6)] // 22:00-5:00
    const total = hourCounts.reduce((sum, c) => sum + c, 0)

    if (total === 0) return true

    const nightTotal = night.reduce((sum, c) => sum + c, 0)
    const nightRatio = nightTotal / total

    // 深夜提交占比應該 < 15%
    return nightRatio < 0.15
  }

  /**
   * 維度2: 檢測週末活躍度
   */
  private static detectWeekendActivity(
    workWeekPl: ParsedGitData['workWeekPl']
  ): ProjectClassificationResult['dimensions']['weekendActivity'] {
    const workdayCount = workWeekPl[0].count
    const weekendCount = workWeekPl[1].count
    const total = workdayCount + weekendCount

    if (total === 0) {
      return {
        ratio: 0,
        description: '無資料',
      }
    }

    const ratio = weekendCount / total

    let description = ''
    if (ratio >= 0.30) {
      description = `${(ratio * 100).toFixed(1)}% (很高週末活躍度)`
    } else if (ratio >= 0.15) {
      description = `${(ratio * 100).toFixed(1)}% (高週末活躍度)`
    } else {
      description = `${(ratio * 100).toFixed(1)}% (低週末活躍度)`
    }

    return {
      ratio,
      description,
    }
  }

  /**
   * 維度3: 檢測月光族模式（工作日晚上 vs 白天）
   */
  private static detectMoonlightingPattern(
    byHour: TimeCount[],
    byDay: TimeCount[],
    dayHourCommits?: any[]
  ): ProjectClassificationResult['dimensions']['moonlightingPattern'] {
    // 獲取工作日的小時資料
    const hourCounts = this.extractWorkdayHourlyData(byHour, byDay, dayHourCommits)

    // 白天時段：9:00-18:00
    const dayTimeCommits = hourCounts.slice(9, 18).reduce((sum, c) => sum + c, 0)

    // 晚上時段：19:00-24:00
    const nightTimeCommits = hourCounts.slice(19, 24).reduce((sum, c) => sum + c, 0)

    const total = dayTimeCommits + nightTimeCommits
    if (total === 0) {
      return {
        isActive: false,
        eveningToMorningRatio: 0,
        nightRatio: 0,
        description: '無資料',
      }
    }

    const nightRatio = nightTimeCommits / total
    const eveningToMorningRatio = nightTimeCommits / dayTimeCommits

    // 判斷標準：晚間提交占比 >= 25% 视為晚間活跃
    const isActive = nightRatio >= 0.25

    let description = ''
    if (nightRatio >= 0.40) {
      description = `晚間高度活跃 (${(nightRatio * 100).toFixed(1)}%)`
    } else if (nightRatio >= 0.30) {
      description = `晚間活躍度較高 (${(nightRatio * 100).toFixed(1)}%)`
    } else if (nightRatio >= 0.25) {
      description = `晚間活跃 (${(nightRatio * 100).toFixed(1)}%)`
    } else {
      description = `晚間活躍度低 (${(nightRatio * 100).toFixed(1)}%)`
    }

    return {
      isActive,
      eveningToMorningRatio,
      nightRatio,
      description,
    }
  }

  /**
   * 综合決策
   */
  private static makeDecision(
    regularity: ProjectClassificationResult['dimensions']['workTimeRegularity'],
    weekend: ProjectClassificationResult['dimensions']['weekendActivity'],
    moonlighting: ProjectClassificationResult['dimensions']['moonlightingPattern'],
    contributorsCount: number
  ): {
    projectType: ProjectType
    confidence: number
    reasoning: string
  } {
    const reasons: string[] = []

    // ========== 強特征判斷（單独滿足即可判定為開源專案）==========

    // 強特征1: 貢獻者數量众多（>=50 人）
    if (contributorsCount >= 50) {
      return {
        projectType: ProjectType.OPEN_SOURCE,
        confidence: Math.min(95, 70 + Math.floor(contributorsCount / 10)),
        reasoning: `貢獻者數量众多 (${contributorsCount} 人)，典型的開源專案特征`,
      }
    }

    // 強特征2: 工作時間規律性極低（<= 25 分）
    if (regularity.score <= 25) {
      return {
        projectType: ProjectType.OPEN_SOURCE,
        confidence: 90,
        reasoning: `工作時間完全無規律 (${regularity.score}/100)，典型的開源專案特征`,
      }
    }

    // ========== 組合判斷（多個弱特征組合）==========

    let ossScore = 0 // 開源專案得分

    // 規律性得分分析
    if (regularity.score < 30) {
      ossScore += 60
      reasons.push(`工作時間規律性極低 (${regularity.score}/100)`)
    } else if (regularity.score < 50) {
      ossScore += 40
      reasons.push(`工作時間規律性低 (${regularity.score}/100)`)
    } else if (regularity.score < 75) {
      ossScore += 20
      reasons.push(`工作時間規律性中等 (${regularity.score}/100)`)
    }

    // 貢獻者數量（20-49人給予適度加分）
    if (contributorsCount >= 20 && contributorsCount < 50) {
      ossScore += 20
      reasons.push(`貢獻者較多 (${contributorsCount} 人)`)
    } else if (contributorsCount >= 10 && contributorsCount < 20) {
      ossScore += 10
      reasons.push(`貢獻者數量中等 (${contributorsCount} 人)`)
    }

    // 週末活躍度分析
    if (weekend.ratio >= 0.30) {
      ossScore += 30
      reasons.push(`週末活躍度高 (${(weekend.ratio * 100).toFixed(1)}%)`)
    } else if (weekend.ratio >= 0.20) {
      ossScore += 20
      reasons.push(`週末活躍度較高 (${(weekend.ratio * 100).toFixed(1)}%)`)
    } else if (weekend.ratio >= 0.15) {
      ossScore += 10
      reasons.push(`週末活躍度中等 (${(weekend.ratio * 100).toFixed(1)}%)`)
    }

    // 月光族模式
    if (moonlighting.isActive) {
      ossScore += 20
      reasons.push('晚上提交量超過白天')
    }

    // 決策逻辑
    let projectType: ProjectType
    let confidence: number
    let reasoning: string

    if (ossScore >= 60) {
      projectType = ProjectType.OPEN_SOURCE
      confidence = Math.min(95, 50 + ossScore / 2)
      reasoning = `開源專案特征明顯：${reasons.join('；')}`
    } else if (ossScore >= 40) {
      projectType = ProjectType.UNCERTAIN
      confidence = 50
      reasoning = `專案特征不明确：${reasons.join('；')}`
    } else {
      projectType = ProjectType.CORPORATE
      confidence = Math.min(95, 80 - ossScore)
      reasoning = '符合公司專案特征'
    }

    return {
      projectType,
      confidence: Math.round(confidence),
      reasoning,
    }
  }
}
