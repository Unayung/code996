/**
 * holiday-calendar 模块的類型聲明
 */
declare module 'holiday-calendar' {
  class HolidayCalendar {
    constructor()

    /**
     * 判斷某個日期是否為工作日
     * @param region 地区程式碼 (例如: 'CN', 'JP')
     * @param date 日期字符串 (YYYY-MM-DD)
     * @returns 是否為工作日
     */
    isWorkday(region: string, date: string): Promise<boolean>

    /**
     * 判斷某個日期是否為假期
     * @param region 地区程式碼 (例如: 'CN', 'JP')
     * @param date 日期字符串 (YYYY-MM-DD)
     * @returns 是否為假期
     */
    isHoliday(region: string, date: string): Promise<boolean>

    /**
     * 獲取指定地区和年份的所有日期資訊
     * @param region 地区程式碼
     * @param year 年份
     * @returns 日期資訊陣列
     */
    getDates(
      region: string,
      year: number,
      filters?: {
        type?: 'public_holiday' | 'transfer_workday'
        startDate?: string
        endDate?: string
      }
    ): Promise<Array<{ date: string; name: string; name_cn: string; name_en: string; type: string }>>

    /**
     * 獲取索引資訊
     * @returns 索引資訊
     */
    getIndex(): Promise<{ regions: Array<{ name: string; startYear: number; endYear: number }> }>
  }

  export default HolidayCalendar
}

