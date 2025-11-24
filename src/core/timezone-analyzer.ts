import { TimezoneData, TimezoneAnalysisResult, TimeCount } from '../types/git-types'

/**
 * 時區分析器
 * 檢測專案是否為跨時區協作，分析時區分布和睡眠時段
 */
export class TimezoneAnalyzer {
  private static readonly CROSS_TIMEZONE_THRESHOLD = 0.01 // 跨時區判定閾值：1%
  private static readonly SLEEP_WINDOW_HOURS = 5 // 睡眠時段視窗：連續5小時
  private static readonly SLEEP_RATIO_THRESHOLD = 0.01 // 睡眠時段提交占比閾值：1%

  /**
   * 分析時區分布，判斷是否為跨時區專案
   * @param timezoneData 時區分布資料
   * @param hourData 24小時提交分布資料
   * @returns 跨時區分析結果
   */
  static analyzeTimezone(timezoneData: TimezoneData, hourData: TimeCount[]): TimezoneAnalysisResult {
    // 如果沒有提交資料，傳回預設結果
    if (timezoneData.totalCommits === 0) {
      return {
        isCrossTimezone: false,
        crossTimezoneRatio: 0,
        dominantTimezone: null,
        dominantRatio: 0,
        sleepPeriodRatio: 0,
        confidence: 0,
      }
    }

    // 方法1：時區离散度分析
    const tzDiversity = this.calculateTimezoneDiversity(timezoneData)

    // 方法2：睡眠時段占比分析
    const sleepAnalysis = this.analyzeSleepPeriod(hourData)

    // 综合判斷：滿足任一條件即视為跨時區
    const isCrossTimezone =
      tzDiversity.crossTimezoneRatio >= this.CROSS_TIMEZONE_THRESHOLD ||
      sleepAnalysis.minSleepRatio >= this.SLEEP_RATIO_THRESHOLD

    // 計算檢測置信度
    const confidence = this.calculateConfidence(tzDiversity, sleepAnalysis, timezoneData.totalCommits)

    return {
      isCrossTimezone,
      crossTimezoneRatio: tzDiversity.crossTimezoneRatio,
      dominantTimezone: tzDiversity.dominantTimezone,
      dominantRatio: tzDiversity.dominantRatio,
      sleepPeriodRatio: sleepAnalysis.minSleepRatio,
      confidence,
      timezoneGroups: tzDiversity.groups,
    }
  }

  /**
   * 計算時區离散度
   * @param data 時區分布資料
   * @returns 時區离散度分析結果
   */
  private static calculateTimezoneDiversity(data: TimezoneData) {
    if (data.timezones.length === 0) {
      return {
        crossTimezoneRatio: 0,
        dominantTimezone: null,
        dominantRatio: 0,
        groups: [],
      }
    }

    // 找出主導時區（提交數最多的時區）
    const dominantTz = data.timezones[0]
    const dominantRatio = dominantTz.count / data.totalCommits

    // 跨時區比例 = 1 - 主導時區比例
    const crossTimezoneRatio = 1 - dominantRatio

    // 建構時區分組詳情（前5個）
    const groups = data.timezones.slice(0, 5).map((tz) => ({
      offset: tz.offset,
      count: tz.count,
      ratio: tz.count / data.totalCommits,
    }))

    return {
      crossTimezoneRatio,
      dominantTimezone: dominantTz.offset,
      dominantRatio,
      groups,
    }
  }

  /**
   * 分析睡眠時段占比
   * 找出提交量最少的連續5小時，檢查其占比
   * @param hourData 24小時提交分布資料
   * @returns 睡眠時段分析結果
   */
  private static analyzeSleepPeriod(hourData: TimeCount[]) {
    // 將 hourData 轉換為 24 小時陣列（聚合半小時資料）
    const hourCounts = this.aggregateToHourArray(hourData)
    const total = hourCounts.reduce((sum, count) => sum + count, 0)

    if (total === 0) {
      return { minSleepRatio: 0, sleepWindow: [] }
    }

    // 使用滑动視窗找出連續5小時提交量最少的時段
    let minSum = Infinity
    let minWindowStart = 0

    for (let start = 0; start < 24; start++) {
      let windowSum = 0

      for (let i = 0; i < this.SLEEP_WINDOW_HOURS; i++) {
        const hour = (start + i) % 24
        windowSum += hourCounts[hour]
      }

      if (windowSum < minSum) {
        minSum = windowSum
        minWindowStart = start
      }
    }

    // 計算最少時段的占比
    const minSleepRatio = minSum / total

    // 建構睡眠時段視窗
    const sleepWindow: number[] = []
    for (let i = 0; i < this.SLEEP_WINDOW_HOURS; i++) {
      sleepWindow.push((minWindowStart + i) % 24)
    }

    return {
      minSleepRatio,
      sleepWindow,
    }
  }

  /**
   * 將 hourData 聚合為 24 小時陣列
   * @param hourData 按小時或半小時統計的提交資料
   * @returns 24小時的提交數量陣列
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
   * 計算檢測置信度
   * @param tzDiversity 時區离散度分析結果
   * @param sleepAnalysis 睡眠時段分析結果
   * @param totalCommits 總提交數
   * @returns 置信度百分比 (0-100)
   */
  private static calculateConfidence(
    tzDiversity: { crossTimezoneRatio: number },
    sleepAnalysis: { minSleepRatio: number },
    totalCommits: number
  ): number {
    // 基础置信度：基於提交數量（提交越多越可信）
    let baseConfidence = 0
    if (totalCommits < 50) {
      baseConfidence = 30
    } else if (totalCommits < 200) {
      baseConfidence = 50
    } else if (totalCommits < 500) {
      baseConfidence = 70
    } else {
      baseConfidence = 85
    }

    // 如果兩種方法都指向跨時區，提升置信度
    const bothMethodsAgree =
      tzDiversity.crossTimezoneRatio >= this.CROSS_TIMEZONE_THRESHOLD &&
      sleepAnalysis.minSleepRatio >= this.SLEEP_RATIO_THRESHOLD

    if (bothMethodsAgree) {
      baseConfidence = Math.min(95, baseConfidence + 15)
    }

    return Math.round(baseConfidence)
  }

  /**
   * 生成跨時區警告資訊
   * @param analysis 跨時區分析結果
   * @returns 格式化的警告文本
   */
  static generateWarningMessage(analysis: TimezoneAnalysisResult): string {
    if (!analysis.isCrossTimezone) {
      return ''
    }

    const lines: string[] = []
    lines.push('⚠️  跨時區協作檢測\n')

    // 時區分布資訊
    if (analysis.timezoneGroups && analysis.timezoneGroups.length > 0) {
      lines.push(
        `檢測到該專案可能涉及跨時區協作（非主導時區占比: ${(analysis.crossTimezoneRatio * 100).toFixed(1)}%），對于跨時區專案可能不准确。`
      )
      lines.push('主要時區分布:')

      for (const group of analysis.timezoneGroups.slice(0, 3)) {
        const percent = (group.ratio * 100).toFixed(1)
        lines.push(`  • ${group.offset}: ${percent}%`)
      }
      lines.push('')
    }

    // 建議
    lines.push('💡 建議使用 --timezone 参數指定時區，例如: --timezone="+0800"')

    return lines.join('\n')
  }
}
