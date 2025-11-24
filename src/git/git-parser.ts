import {
  GitLogData,
  ParsedGitData,
  TimeCount,
  ValidationResult,
  WorkTimeData,
  Result996,
  WorkWeekPl,
  WorkTimeDetectionResult,
  DailyCommitCount,
} from '../types/git-types'
import { calculate996Index } from '../core/calculator'
import { WorkTimeAnalyzer } from '../core/work-time-analyzer'
import { OvertimeAnalyzer } from '../core/overtime-analyzer'
import { getWorkdayChecker } from '../utils/workday-checker'

export class GitParser {
  /**
   * 將原始Git資料轉換為標準化格式
   * @param rawData 原始Git資料
   * @param customWorkHours 可選的自定義工作時間（格式："9-18"），如果不提供則自動識別
   * @param since 開始日期
   * @param until 結束日期
   * @param enableHolidayMode 是否啟用節假日調休模式（預設 true）
   */
  static async parseGitData(
    rawData: GitLogData,
    customWorkHours?: string,
    since?: string,
    until?: string,
    enableHolidayMode: boolean = true
  ): Promise<ParsedGitData> {
    // 智慧識別或使用自定義的工作時間
    const workTimeDetection = customWorkHours
      ? this.parseCustomWorkHours(customWorkHours)
      : WorkTimeAnalyzer.detectWorkingHours(rawData.byHour, rawData.dailyFirstCommits || [])

    // 計算加班相關分析
    const weekdayOvertime =
      rawData.dayHourCommits && rawData.dayHourCommits.length > 0
        ? OvertimeAnalyzer.calculateWeekdayOvertime(rawData.dayHourCommits, workTimeDetection)
        : undefined

    const weekendOvertime =
      rawData.dailyCommitHours && rawData.dailyCommitHours.length > 0
        ? await OvertimeAnalyzer.calculateWeekendOvertime(rawData.dailyCommitHours, enableHolidayMode)
        : undefined

    const lateNightAnalysis =
      rawData.dailyLatestCommits &&
      rawData.dailyLatestCommits.length > 0 &&
      rawData.dailyFirstCommits &&
      rawData.dailyFirstCommits.length > 0
        ? await OvertimeAnalyzer.calculateLateNightAnalysis(
            rawData.dailyLatestCommits,
            rawData.dailyFirstCommits,
            workTimeDetection,
            since || undefined,
            until || undefined,
            enableHolidayMode
          )
        : undefined

    // 使用 dailyCommitCounts 中的日期資訊來正確判斷工作日/週末（考慮中國調休）
    const workWeekPl = await this.calculateWorkWeekPl(
      rawData.byDay,
      rawData.dailyCommitCounts || [],
      rawData.byHour,
      enableHolidayMode
    )

    return {
      hourData: rawData.byHour,
      dayData: rawData.byDay,
      totalCommits: rawData.totalCommits,
      workHourPl: this.calculateWorkHourPl(rawData.byHour, workTimeDetection),
      workWeekPl: workWeekPl as unknown as WorkWeekPl,
      detectedWorkTime: workTimeDetection, // 保存識別的工作時間
      dailyFirstCommits: rawData.dailyFirstCommits,
      weekdayOvertime,
      weekendOvertime,
      lateNightAnalysis,
    }
  }

  /**
   * 解析自定義工作時間字符串
   * @param customWorkHours 格式："9-18" 或 "9.5-18.5" (支援小數，0.5代表30分鐘)
   * @returns 工作時間識別結果
   */
  private static parseCustomWorkHours(customWorkHours: string): WorkTimeDetectionResult {
    const parts = customWorkHours.split('-')
    if (parts.length !== 2) {
      throw new Error(`無效的工作時間格式: ${customWorkHours}，正確格式為 "9-18" 或 "9.5-18.5"`)
    }

    const startHour = parseFloat(parts[0])
    const endHour = parseFloat(parts[1])

    if (isNaN(startHour) || isNaN(endHour) || startHour < 0 || startHour > 23 || endHour < 0 || endHour > 24) {
      throw new Error(`無效的工作時間: ${customWorkHours}，小時必須在 0-23 之間，結束時間可到24`)
    }

    if (startHour >= endHour) {
      throw new Error(`無效的工作時間: ${customWorkHours}，上班時間必須早於下班時間`)
    }

    return {
      startHour,
      endHour,
      isReliable: true,
      sampleCount: -1, // -1 表示手動指定
      detectionMethod: 'manual',
      confidence: 100, // 手動指定視為最高置信度
      startHourRange: {
        startHour,
        endHour: Math.min(endHour, startHour + 1),
      },
      endHourRange: {
        startHour: Math.max(startHour, endHour - 1),
        endHour,
      },
      endDetectionMethod: 'manual',
    }
  }

  /**
   * 計算工作時間分布（按小時）
   * @param hourData 按小時統計的commit資料
   * @param workTimeDetection 工作時間識別結果
   */
  private static calculateWorkHourPl(hourData: TimeCount[], workTimeDetection: WorkTimeDetectionResult): WorkTimePl {
    let workCount = 0
    let overtimeCount = 0

    for (const item of hourData) {
      const hour = parseInt(item.time, 10)

      // 判斷是否在工作時間內
      if (WorkTimeAnalyzer.isWorkingHour(hour, workTimeDetection)) {
        workCount += item.count
      } else {
        overtimeCount += item.count
      }
    }

    return [
      { time: '工作', count: workCount },
      { time: '加班', count: overtimeCount },
    ]
  }

  /**
   * 計算工作時間分布（按星期）
   * 使用 holiday-calendar 支援中國調休制度
   * @param dayData 按星期統計的提交數（相容性保留）
   * @param dailyCommitCounts 每日提交數列表（包含具體日期和提交數）
   * @param hourData 按小時統計的提交數（用於驗證）
   * @param enableHolidayMode 是否啟用節假日調休模式
   */
  private static async calculateWorkWeekPl(
    dayData: TimeCount[],
    dailyCommitCounts: DailyCommitCount[],
    hourData: TimeCount[],
    enableHolidayMode: boolean = true
  ): Promise<WorkDayPl> {
    // 如果沒有具體日期資訊，回退到基礎判斷（週一到週五為工作日）
    if (!dailyCommitCounts || dailyCommitCounts.length === 0) {
      return this.calculateWorkWeekPlBasic(dayData)
    }

    try {
      const checker = getWorkdayChecker(enableHolidayMode)

      // 批量判斷所有日期是否為工作日
      const dates = dailyCommitCounts.map((item) => item.date)
      const isWorkdayResults = await checker.isWorkdayBatch(dates)

      let workDayCount = 0
      let weekendCount = 0

      dailyCommitCounts.forEach((item, index) => {
        if (isWorkdayResults[index]) {
          workDayCount += item.count
        } else {
          weekendCount += item.count
        }
      })

      return [
        { time: '工作日', count: workDayCount },
        { time: '週末', count: weekendCount },
      ]
    } catch (error) {
      // 如果 holiday-calendar 查詢失敗，回退到基礎判斷
      console.warn('使用 holiday-calendar 失敗，回退到基礎判斷:', error)
      return this.calculateWorkWeekPlBasic(dayData)
    }
  }

  /**
   * 基礎的工作日/週末判斷（不考慮調休）
   * 週一到週五為工作日，週六日為週末
   */
  private static calculateWorkWeekPlBasic(dayData: TimeCount[]): WorkDayPl {
    let workDayCount = 0
    let weekendCount = 0

    for (const item of dayData) {
      const day = parseInt(item.time, 10)

      // 工作日：週一到週五（1-5）
      if (day >= 1 && day <= 5) {
        workDayCount += item.count
      } else {
        weekendCount += item.count
      }
    }

    return [
      { time: '工作日', count: workDayCount },
      { time: '週末', count: weekendCount },
    ]
  }

  /**
   * 驗證資料的完整性
   */
  static validateData(data: ParsedGitData): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // 檢查總commit數是否一致
    const hourTotal = data.hourData.reduce((sum, item) => sum + item.count, 0)
    const dayTotal = data.dayData.reduce((sum, item) => sum + item.count, 0)

    if (hourTotal !== data.totalCommits) {
      errors.push(`按小時統計的總commit數(${hourTotal})與實際總commit數(${data.totalCommits})不一致`)
    }

    if (dayTotal !== data.totalCommits) {
      errors.push(`按星期統計的總commit數(${dayTotal})與實際總commit數(${data.totalCommits})不一致`)
    }

    // 檢查是否有足夠的資料
    if (data.totalCommits === 0) {
      warnings.push('儲存庫中沒有找到commit記錄')
    }

    // 檢查資料分布
    const workHourCount = data.workHourPl[0].count
    const overtimeHourCount = data.workHourPl[1].count
    const workDayCount = data.workWeekPl[0].count
    const weekendCount = data.workWeekPl[1].count

    if (workHourCount === 0 && overtimeHourCount > 0) {
      warnings.push('所有commit都在非工作時間，可能是加班嚴重或工作時間設定不合理')
    }

    if (workDayCount === 0 && weekendCount > 0) {
      warnings.push('所有commit都在週末，可能是週末工作或工作日設定不合理')
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * 計算 996 指數
   */
  static calculate996Index(data: ParsedGitData): Result996 {
    const workTimeData: WorkTimeData = {
      workHourPl: data.workHourPl,
      workWeekPl: data.workWeekPl,
      hourData: data.hourData,
    }

    return calculate996Index(workTimeData)
  }
}

export type WorkTimePl = [{ time: '工作' | '加班'; count: number }, { time: '工作' | '加班'; count: number }]

export type WorkDayPl = [{ time: '工作日' | '週末'; count: number }, { time: '工作日' | '週末'; count: number }]
