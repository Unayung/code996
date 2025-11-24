import { DailyFirstCommit, TimeCount, WorkTimeDetectionResult } from '../types/git-types'
import { detectEndHourWindow } from './end-hour-detector'
import { TimeAggregator } from '../utils/time-aggregator'

/**
 * 工作時間分析器
 * 根據每日最早提交時間推算上班時間，並利用小時分布估计下班時間
 */
export class WorkTimeAnalyzer {
  private static readonly STANDARD_WORK_HOURS = 9 // 預設工作時长兜底
  private static readonly MIN_VALID_MINUTES = 5 * 60 // 過濾非正常資料（早於5点视為無效）
  private static readonly MAX_VALID_MINUTES = 12 * 60 // 晚於中午12点视為無效

  /**
   * 檢測工作時間
   * @param hourData 按小時或半小時統計的提交數量
   * @param dayData 按星期統計的提交數量（保留参數以相容舊逻辑）
   * @param dailyFirstCommits 每日最早提交時間集合
   */
  static detectWorkingHours(
    hourData: TimeCount[],
    dailyFirstCommits: DailyFirstCommit[] = []
  ): WorkTimeDetectionResult {
    // 如果是半小時資料，先聚合為小時資料用於算法分析
    const granularity = TimeAggregator.detectGranularity(hourData)
    const hourDataForAnalysis = granularity === 'half-hour' ? TimeAggregator.aggregateToHour(hourData) : hourData

    const filteredDailyCommits = this.filterValidDailyCommits(dailyFirstCommits)
    const sampleCount = filteredDailyCommits.length

    const minutesSamples = filteredDailyCommits.map((item) => item.minutesFromMidnight)
    let detectionMethod: WorkTimeDetectionResult['detectionMethod'] = 'default'

    let startRange: { startHour: number; endHour: number }
    const defaultMinutes = 9 * 60
    if (minutesSamples.length > 0) {
      const lowerQuantile = this.calculateQuantile(minutesSamples, 0.1, defaultMinutes)
      const upperQuantile = this.calculateQuantile(minutesSamples, 0.2, lowerQuantile + 60)
      startRange = this.buildStartHourRange(lowerQuantile, upperQuantile)
      detectionMethod = 'quantile-window'
    } else {
      startRange = this.buildStartHourRange(defaultMinutes, defaultMinutes + 30)
    }

    const startHour = startRange.startHour
    const standardEndHour = Math.min(startHour + this.STANDARD_WORK_HOURS, 24)
    const observedEndWindow = detectEndHourWindow(hourDataForAnalysis, startHour, standardEndHour)
    const standardRange = this.buildEndHourRange(startHour, standardEndHour)

    const useObserved = observedEndWindow.method === 'backward-threshold'
    const effectiveEndHour = useObserved ? observedEndWindow.endHour : standardEndHour
    const effectiveRange = useObserved ? observedEndWindow.range : standardRange
    const endDetectionMethod = useObserved ? 'backward-threshold' : 'standard-shift'
    const confidence = this.estimateConfidence(sampleCount)

    return {
      startHour,
      endHour: effectiveEndHour,
      isReliable: confidence >= 60,
      sampleCount,
      detectionMethod,
      confidence,
      startHourRange: startRange,
      endHourRange: effectiveRange,
      endDetectionMethod,
    }
  }

  /**
   * 根據識別結果判斷某個整点是否屬於工作時間
   */
  static isWorkingHour(hour: number, detection: WorkTimeDetectionResult): boolean {
    const hourStartMinutes = hour * 60
    const startMinutes = detection.startHour * 60
    // 加班判定：即便檢測到更晚的下班時間，正常工時最多只統計 9 小時
    const cappedEndHour = Math.min(detection.endHour, detection.startHour + this.STANDARD_WORK_HOURS)
    const endMinutes = Math.max(startMinutes, cappedEndHour * 60)
    return hourStartMinutes >= startMinutes && hourStartMinutes < endMinutes
  }

  /**
   * 過濾異常的每日最早提交資料（如凌晨噪点）
   */
  private static filterValidDailyCommits(dailyFirstCommits: DailyFirstCommit[]): DailyFirstCommit[] {
    return dailyFirstCommits.filter((item) => {
      if (item.minutesFromMidnight < this.MIN_VALID_MINUTES || item.minutesFromMidnight > this.MAX_VALID_MINUTES) {
        return false
      }

      const weekDay = new Date(`${item.date}T00:00:00Z`).getUTCDay()
      return weekDay >= 1 && weekDay <= 5
    })
  }

  /**
   * 計算分鐘陣列的分位數，若樣本不足則回退到給定的預設值
   */
  private static calculateQuantile(samples: number[], quantile: number, fallback: number): number {
    if (!samples || samples.length === 0) {
      return fallback
    }

    const sorted = [...samples].sort((a, b) => a - b)
    const index = Math.floor((sorted.length - 1) * quantile)
    const value = sorted[index]

    if (value === undefined || Number.isNaN(value)) {
      return fallback
    }

    return value
  }

  /**
   * 將分鐘數向下取整到最近的 30 分鐘刻度
   */
  private static roundDownToHalfHour(minutes: number): number {
    const halfHourBlock = Math.floor(minutes / 30)
    return halfHourBlock * 30
  }

  /**
   * 建構上班時間段，基於分位數生成最长 1 小時的範圍
   */
  private static buildStartHourRange(
    lowerMinutes: number,
    upperMinutes: number
  ): { startHour: number; endHour: number } {
    const boundedLower = Math.max(this.MIN_VALID_MINUTES, Math.min(lowerMinutes, this.MAX_VALID_MINUTES))
    const boundedUpper = Math.max(this.MIN_VALID_MINUTES, Math.min(upperMinutes, this.MAX_VALID_MINUTES))

    const sanitizedLower = this.roundDownToHalfHour(boundedLower)
    const sanitizedUpper = this.roundDownToHalfHour(Math.max(boundedUpper, sanitizedLower + 30))

    const start = Math.min(sanitizedLower, sanitizedUpper)
    let end = Math.max(sanitizedUpper, start + 30)

    // 限制範圍不超過 1 小時，且不晚於中午 12 点
    end = Math.min(end, start + 60, this.MAX_VALID_MINUTES)

    return {
      startHour: start / 60,
      endHour: end / 60,
    }
  }

  /**
   * 根據最早上班時間推導標準 9 小時工作日的下班時間段
   */
  private static buildEndHourRange(startHour: number, endHour: number): { startHour: number; endHour: number } {
    const startMinutes = this.roundDownToHalfHour(Math.max(startHour * 60, this.MIN_VALID_MINUTES))
    const rawEndMinutes = Math.max(endHour * 60, startMinutes + this.STANDARD_WORK_HOURS * 60)
    const boundedEndMinutes = Math.min(rawEndMinutes, 24 * 60)
    const sanitizedEndMinutes = this.roundDownToHalfHour(boundedEndMinutes)

    const rangeEnd = sanitizedEndMinutes > 0 ? sanitizedEndMinutes : Math.min((startHour + 1) * 60, 24 * 60)
    const rangeStart = Math.max(startMinutes, rangeEnd - 60)

    return {
      startHour: rangeStart / 60,
      endHour: rangeEnd / 60,
    }
  }

  /**
   * 根據樣本數量估算置信度（百分比）
   * 使用渐近函數，無限趋近90%但永不達到
   */
  private static estimateConfidence(sampleDays: number): number {
    if (sampleDays <= 0) {
      return 0
    }

    // 使用渐近函數：confidence = 90 * sampleDays / (sampleDays + 50)
    const confidence = (90 * sampleDays) / (sampleDays + 50)
    return Math.round(confidence)
  }
}
