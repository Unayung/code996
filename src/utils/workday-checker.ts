/**
 * 工作日檢查工具
 * 集成 holiday-calendar 包，支援中國調休制度
 */

import HolidayCalendar from 'holiday-calendar'

/**
 * 工作日檢查器
 * 封裝 holiday-calendar 的調用逻辑，支援中國法定節假日和調休工作日
 * 預設只支援中國（CN）地区
 */
export class WorkdayChecker {
  private calendar: HolidayCalendar
  private readonly region = 'CN'
  private enabled: boolean

  constructor(enabled: boolean = true) {
    this.calendar = new HolidayCalendar()
    this.enabled = enabled
  }

  /**
   * 判斷某個日期是否為工作日
   * @param date 日期字符串 (YYYY-MM-DD) 或 Date 對象
   * @returns 是否為工作日
   */
  async isWorkday(date: string | Date): Promise<boolean> {
    // 如果未啟用節假日調休功能，直接使用基础判斷
    if (!this.enabled) {
      return this.fallbackIsWorkday(date)
    }

    const dateStr = this.formatDate(date)
    try {
      return await this.calendar.isWorkday(this.region, dateStr)
    } catch (error) {
      // 如果查詢失敗（可能是資料不存在），回退到基础判斷
      return this.fallbackIsWorkday(date)
    }
  }

  /**
   * 判斷某個日期是否為假期（法定節假日或週末）
   * @param date 日期字符串 (YYYY-MM-DD) 或 Date 對象
   * @returns 是否為假期
   */
  async isHoliday(date: string | Date): Promise<boolean> {
    // 如果未啟用節假日調休功能，直接使用基础判斷
    if (!this.enabled) {
      return this.fallbackIsHoliday(date)
    }

    const dateStr = this.formatDate(date)
    try {
      return await this.calendar.isHoliday(this.region, dateStr)
    } catch (error) {
      // 如果查詢失敗，回退到基础判斷
      return this.fallbackIsHoliday(date)
    }
  }

  /**
   * 批量判斷多個日期是否為工作日
   * @param dates 日期陣列
   * @returns 工作日判斷結果陣列
   */
  async isWorkdayBatch(dates: Array<string | Date>): Promise<boolean[]> {
    return Promise.all(dates.map((date) => this.isWorkday(date)))
  }

  /**
   * 批量判斷多個日期是否為假期
   * @param dates 日期陣列
   * @returns 假期判斷結果陣列
   */
  async isHolidayBatch(dates: Array<string | Date>): Promise<boolean[]> {
    return Promise.all(dates.map((date) => this.isHoliday(date)))
  }

  /**
   * 格式化日期為 YYYY-MM-DD
   */
  private formatDate(date: string | Date): string {
    if (typeof date === 'string') {
      return date
    }
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  /**
   * 回退方案：基础的工作日判斷（不考慮調休）
   * 當 holiday-calendar 資料不可用時使用
   */
  private fallbackIsWorkday(date: string | Date): boolean {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    const dayOfWeek = dateObj.getDay()
    // 週一到週五為工作日
    return dayOfWeek >= 1 && dayOfWeek <= 5
  }

  /**
   * 回退方案：基础的假期判斷（不考慮調休）
   * 當 holiday-calendar 資料不可用時使用
   */
  private fallbackIsHoliday(date: string | Date): boolean {
    const dateObj = typeof date === 'string' ? new Date(date) : date
    const dayOfWeek = dateObj.getDay()
    // 週六日為假期
    return dayOfWeek === 0 || dayOfWeek === 6
  }
}

/**
 * 创建預設的工作日檢查器實例（單例模式）
 */
let defaultChecker: WorkdayChecker | null = null

/**
 * 獲取預設的工作日檢查器（單例模式）
 * @param enabled 是否啟用節假日調休功能（預設 true）
 */
export function getWorkdayChecker(enabled: boolean = true): WorkdayChecker {
  // 如果啟用状態改變，重新创建實例
  if (!defaultChecker || (defaultChecker as any).enabled !== enabled) {
    defaultChecker = new WorkdayChecker(enabled)
  }
  return defaultChecker
}

/**
 * 重置工作日檢查器（用於切換啟用状態）
 */
export function resetWorkdayChecker(): void {
  defaultChecker = null
}

/**
 * 便捷方法：判斷是否為工作日
 */
export async function isWorkday(date: string | Date): Promise<boolean> {
  const checker = getWorkdayChecker()
  return checker.isWorkday(date)
}

/**
 * 便捷方法：判斷是否為假期
 */
export async function isHoliday(date: string | Date): Promise<boolean> {
  const checker = getWorkdayChecker()
  return checker.isHoliday(date)
}

