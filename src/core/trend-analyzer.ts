import { GitCollector } from '../git/git-collector'
import { GitParser } from '../git/git-parser'
import { GitDataMerger } from '../git/git-data-merger'
import { calculate996Index } from './calculator'
import { WorkSpanCalculator } from './work-span-calculator'
import {
  TrendAnalysisResult,
  MonthlyTrendData,
  DailyWorkSpan,
  DailyFirstCommit,
  DailyLatestCommit,
  GitLogData,
} from '../types/git-types'

/**
 * 趨勢分析器
 * 按月分析 996 指數和工作時間的變化趨勢
 */
export class TrendAnalyzer {
  /**
   * 分析指定時間範圍内的月度趨勢（單儲存庫）
   * @param path Git 儲存庫路径
   * @param since 開始日期 (YYYY-MM-DD)
   * @param until 結束日期 (YYYY-MM-DD)
   * @param authorPattern 作者過濾正則（僅統計指定作者）
   * @param progressCallback 進度回調函數 (目前月份, 總月數, 月份名称)
   * @param timezone 時區過濾（例如: +0800）
   * @param enableHolidayMode 是否啟用節假日調休模式（預設 true）
   * @returns 趨勢分析結果
   */
  static async analyzeTrend(
    path: string,
    since: string | null,
    until: string | null,
    authorPattern?: string,
    progressCallback?: (current: number, total: number, month: string) => void,
    timezone?: string,
    enableHolidayMode: boolean = true
  ): Promise<TrendAnalysisResult> {
    const collector = new GitCollector()

    // 如果時間範圍為空，自動獲取
    if (!since || !until) {
      const firstCommit = await collector.getFirstCommitDate({ path })
      const lastCommit = await collector.getLastCommitDate({ path })
      since = since || firstCommit
      until = until || lastCommit
    }

    // 生成月份列表
    const months = this.generateMonthsList(since, until)

    // 串行分析每個月的資料（以便顯示進度）
    const monthlyData: (MonthlyTrendData | null)[] = []
    for (let i = 0; i < months.length; i++) {
      if (progressCallback) {
        progressCallback(i + 1, months.length, months[i])
      }
      const data = await this.analyzeMonth(collector, path, months[i], authorPattern, timezone, enableHolidayMode)
      monthlyData.push(data)
    }

    // 過濾掉資料不足的月份（可選，這裡保留所有月份）
    const validMonthlyData = monthlyData.filter((data) => data !== null) as MonthlyTrendData[]

    // 計算整體趨勢
    const summary = this.calculateSummary(validMonthlyData)

    return {
      monthlyData: validMonthlyData,
      timeRange: { since, until },
      summary,
    }
  }

  /**
   * 分析指定時間範圍内的月度趨勢（多儲存庫彙總）
   * @param paths Git 儲存庫路径列表
   * @param since 開始日期 (YYYY-MM-DD)
   * @param until 結束日期 (YYYY-MM-DD)
   * @param authorPattern 作者過濾正則（僅統計指定作者）
   * @param progressCallback 進度回調函數 (目前月份, 總月數, 月份名称)
   * @param timezone 時區過濾（例如: +0800）
   * @param enableHolidayMode 是否啟用節假日調休模式（預設 true）
   * @returns 趨勢分析結果
   */
  static async analyzeMultiRepoTrend(
    paths: string[],
    since: string | null,
    until: string | null,
    authorPattern: string | undefined,
    progressCallback?: (current: number, total: number, month: string) => void,
    timezone?: string,
    enableHolidayMode: boolean = true
  ): Promise<TrendAnalysisResult> {
    const collector = new GitCollector()

    // 如果時間範圍為空，自動獲取所有儲存庫中最早和最晚的提交
    if (!since || !until) {
      const dates = await Promise.all(
        paths.map(async (path) => {
          try {
            const firstCommit = await collector.getFirstCommitDate({ path })
            const lastCommit = await collector.getLastCommitDate({ path })
            return { firstCommit, lastCommit }
          } catch {
            return null
          }
        })
      )

      const validDates = dates.filter((d) => d !== null) as { firstCommit: string; lastCommit: string }[]
      if (validDates.length > 0) {
        since =
          since || validDates.reduce((min, d) => (d.firstCommit < min ? d.firstCommit : min), validDates[0].firstCommit)
        until =
          until || validDates.reduce((max, d) => (d.lastCommit > max ? d.lastCommit : max), validDates[0].lastCommit)
      }
    }

    if (!since || !until) {
      throw new Error('無法確定時間範圍')
    }

    // 生成月份列表
    const months = this.generateMonthsList(since, until)

    // 串行分析每個月的資料（以便顯示進度）
    const monthlyData: (MonthlyTrendData | null)[] = []
    for (let i = 0; i < months.length; i++) {
      if (progressCallback) {
        progressCallback(i + 1, months.length, months[i])
      }
      const data = await this.analyzeMonthMultiRepo(collector, paths, months[i], authorPattern, timezone, enableHolidayMode)
      monthlyData.push(data)
    }

    // 過濾掉資料不足的月份（可選，這裡保留所有月份）
    const validMonthlyData = monthlyData.filter((data) => data !== null) as MonthlyTrendData[]

    // 計算整體趨勢
    const summary = this.calculateSummary(validMonthlyData)

    return {
      monthlyData: validMonthlyData,
      timeRange: { since, until },
      summary,
    }
  }

  /**
   * 分析單個月份的資料（多儲存庫彙總）
   */
  private static async analyzeMonthMultiRepo(
    collector: GitCollector,
    paths: string[],
    month: string,
    authorPattern?: string,
    timezone?: string,
    enableHolidayMode: boolean = true
  ): Promise<MonthlyTrendData | null> {
    try {
      // 計算該月的起止日期
      const { since, until } = this.getMonthRange(month)

      // 蒐集所有儲存庫在該月的資料
      const monthDataList: GitLogData[] = []
      const contributorSet = new Set<string>()

      for (const path of paths) {
        try {
          const gitLogData = await collector.collect({ path, since, until, authorPattern, timezone, silent: true })
          if (gitLogData.totalCommits > 0) {
            monthDataList.push(gitLogData)
            // 蒐集参與者（如果有的话）
            if (gitLogData.contributors) {
              contributorSet.add(path) // 簡化處理，用路径代表儲存庫
            }
          }
        } catch {
          // 單個儲存庫失敗不影響其他儲存庫
          continue
        }
      }

      // 如果所有儲存庫該月都沒有提交，傳回空資料
      if (monthDataList.length === 0) {
        return {
          month,
          index996: 0,
          avgWorkSpan: 0,
          workSpanStdDev: 0,
          avgStartTime: '--:--',
          avgEndTime: '--:--',
          latestEndTime: '--:--',
          totalCommits: 0,
          contributors: 0,
          workDays: 0,
          dataQuality: 'insufficient',
          confidence: 'low',
        }
      }

      // 合併所有儲存庫的資料
      const mergedData = GitDataMerger.merge(monthDataList)

      // 解析資料並計算 996 指數
      const parsedData = await GitParser.parseGitData(mergedData, undefined, since, until, enableHolidayMode)
      const result996 = calculate996Index({
        workHourPl: parsedData.workHourPl,
        workWeekPl: parsedData.workWeekPl,
        hourData: parsedData.hourData,
      })

      // 計算工作跨度指標
      const dailySpans = this.calculateWorkSpansFromData(
        mergedData.dailyFirstCommits || [],
        mergedData.dailyLatestCommits || []
      )

      const avgWorkSpan = WorkSpanCalculator.calculateAverage(dailySpans)
      const workSpanStdDev = WorkSpanCalculator.calculateStdDev(dailySpans)
      const avgStartTime = await WorkSpanCalculator.getAverageStartTime(dailySpans)
      const avgEndTime = await WorkSpanCalculator.getAverageEndTime(dailySpans)
      const latestEndTime = WorkSpanCalculator.getLatestEndTime(dailySpans)

      // 判斷資料品質
      const workDays = dailySpans.length
      const dataQuality = workDays >= 10 ? 'sufficient' : workDays >= 5 ? 'limited' : 'insufficient'

      // 計算置信度：综合提交數和工作天數
      const confidence = this.calculateConfidence(mergedData.totalCommits, workDays)

      // 統計總参與人數（所有儲存庫的貢獻者數量之和）
      const totalContributors = monthDataList.reduce((sum, data) => sum + (data.contributors || 0), 0)

      return {
        month,
        index996: result996.index996,
        avgWorkSpan,
        workSpanStdDev,
        avgStartTime,
        avgEndTime,
        latestEndTime,
        totalCommits: mergedData.totalCommits,
        contributors: totalContributors,
        workDays,
        dataQuality,
        confidence,
      }
    } catch (error) {
      console.error(`分析月份 ${month} 時出错:`, error)
      return null
    }
  }

  /**
   * 分析單個月份的資料（單儲存庫）
   * @param authorPattern 作者過濾正則
   * @param timezone 時區過濾
   * @param enableHolidayMode 是否啟用節假日調休模式
   */
  private static async analyzeMonth(
    collector: GitCollector,
    path: string,
    month: string,
    authorPattern?: string,
    timezone?: string,
    enableHolidayMode: boolean = true
  ): Promise<MonthlyTrendData | null> {
    try {
      // 計算該月的起止日期
      const { since, until } = this.getMonthRange(month)

      // 蒐集該月的 Git 資料（靜默模式，不打印日誌）
      const gitLogData = await collector.collect({ path, since, until, silent: true, authorPattern, timezone })

      // 如果該月沒有提交，傳回空資料
      if (gitLogData.totalCommits === 0) {
        return {
          month,
          index996: 0,
          avgWorkSpan: 0,
          workSpanStdDev: 0,
          avgStartTime: '--:--',
          avgEndTime: '--:--',
          latestEndTime: '--:--',
          totalCommits: 0,
          contributors: 0,
          workDays: 0,
          dataQuality: 'insufficient',
          confidence: 'low',
        }
      }

      // 解析資料並計算 996 指數
      const parsedData = await GitParser.parseGitData(gitLogData, undefined, since, until, enableHolidayMode)
      const result996 = calculate996Index({
        workHourPl: parsedData.workHourPl,
        workWeekPl: parsedData.workWeekPl,
        hourData: parsedData.hourData,
      })

      // 計算工作跨度指標
      const dailySpans = this.calculateWorkSpansFromData(
        gitLogData.dailyFirstCommits || [],
        gitLogData.dailyLatestCommits || []
      )

      const avgWorkSpan = WorkSpanCalculator.calculateAverage(dailySpans)
      const workSpanStdDev = WorkSpanCalculator.calculateStdDev(dailySpans)
      const avgStartTime = await WorkSpanCalculator.getAverageStartTime(dailySpans)
      const avgEndTime = await WorkSpanCalculator.getAverageEndTime(dailySpans)
      const latestEndTime = WorkSpanCalculator.getLatestEndTime(dailySpans)

      // 判斷資料品質
      const workDays = dailySpans.length
      const dataQuality = workDays >= 10 ? 'sufficient' : workDays >= 5 ? 'limited' : 'insufficient'

      // 計算置信度：综合提交數和工作天數
      const confidence = this.calculateConfidence(gitLogData.totalCommits, workDays)

      return {
        month,
        index996: result996.index996,
        avgWorkSpan,
        workSpanStdDev,
        avgStartTime,
        avgEndTime,
        latestEndTime,
        totalCommits: gitLogData.totalCommits,
        contributors: gitLogData.contributors || 0,
        workDays,
        dataQuality,
        confidence,
      }
    } catch (error) {
      console.error(`分析月份 ${month} 時出错:`, error)
      return null
    }
  }

  /**
   * 從每日首次和最後提交資料計算工作跨度
   */
  private static calculateWorkSpansFromData(
    dailyFirstCommits: DailyFirstCommit[],
    dailyLatestCommits: DailyLatestCommit[]
  ): DailyWorkSpan[] {
    const spans: DailyWorkSpan[] = []

    // 创建最晚提交的映射表（現在直接存储分鐘數）
    const latestCommitMap = new Map<string, number>()
    for (const commit of dailyLatestCommits) {
      latestCommitMap.set(commit.date, commit.minutesFromMidnight)
    }

    // 遍歷每日首次提交，計算工作跨度
    for (const firstCommit of dailyFirstCommits) {
      const lastCommitMinutes = latestCommitMap.get(firstCommit.date)
      if (lastCommitMinutes === undefined) continue

      const firstCommitMinutes = firstCommit.minutesFromMidnight

      const spanHours = (lastCommitMinutes - firstCommitMinutes) / 60

      // 過濾異常資料（工作跨度不應為负或超過 24 小時）
      if (spanHours >= 0 && spanHours <= 24) {
        spans.push({
          date: firstCommit.date,
          firstCommitMinutes,
          lastCommitMinutes,
          spanHours,
          commitCount: 1, // 這裡簡化處理，實際可以從其他資料源獲取
        })
      }
    }

    return spans
  }

  /**
   * 生成月份列表
   * @param since 開始日期 (YYYY-MM-DD)
   * @param until 結束日期 (YYYY-MM-DD)
   * @returns 月份列表 (YYYY-MM)
   */
  private static generateMonthsList(since: string, until: string): string[] {
    const months: string[] = []
    const startDate = new Date(since)
    const endDate = new Date(until)

    let current = new Date(startDate.getFullYear(), startDate.getMonth(), 1)

    while (current <= endDate) {
      const year = current.getFullYear()
      const month = String(current.getMonth() + 1).padStart(2, '0')
      months.push(`${year}-${month}`)

      // 移动到下個月
      current.setMonth(current.getMonth() + 1)
    }

    return months
  }

  /**
   * 獲取月份的起止日期
   * @param month 月份 (YYYY-MM)
   * @returns 起止日期
   */
  private static getMonthRange(month: string): { since: string; until: string } {
    const [year, monthNum] = month.split('-').map(Number)

    const startDate = new Date(year, monthNum - 1, 1)
    const endDate = new Date(year, monthNum, 0) // 當月最後一天

    const since = this.formatDate(startDate)
    const until = this.formatDate(endDate)

    return { since, until }
  }

  /**
   * 格式化日期為 YYYY-MM-DD
   */
  private static formatDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  /**
   * 計算整體趨勢摘要
   */
  private static calculateSummary(monthlyData: MonthlyTrendData[]): TrendAnalysisResult['summary'] {
    if (monthlyData.length === 0) {
      return {
        totalMonths: 0,
        avgIndex996: 0,
        avgWorkSpan: 0,
        trend: 'stable',
      }
    }

    // 只統計資料充足的月份
    const validData = monthlyData.filter((d) => d.dataQuality === 'sufficient')

    if (validData.length === 0) {
      return {
        totalMonths: monthlyData.length,
        avgIndex996: 0,
        avgWorkSpan: 0,
        trend: 'stable',
      }
    }

    const totalMonths = validData.length
    const avgIndex996 = validData.reduce((sum, d) => sum + d.index996, 0) / totalMonths
    const avgWorkSpan = validData.reduce((sum, d) => sum + d.avgWorkSpan, 0) / totalMonths

    // 簡單的趨勢判斷：比較前半段和後半段的平均值
    const trend = this.determineTrend(validData)

    return {
      totalMonths,
      avgIndex996,
      avgWorkSpan,
      trend,
    }
  }

  /**
   * 判斷整體趨勢
   */
  private static determineTrend(data: MonthlyTrendData[]): 'increasing' | 'decreasing' | 'stable' {
    if (data.length < 2) return 'stable'

    const midPoint = Math.floor(data.length / 2)
    const firstHalf = data.slice(0, midPoint)
    const secondHalf = data.slice(midPoint)

    const firstHalfAvg = firstHalf.reduce((sum, d) => sum + d.index996, 0) / firstHalf.length
    const secondHalfAvg = secondHalf.reduce((sum, d) => sum + d.index996, 0) / secondHalf.length

    const diff = secondHalfAvg - firstHalfAvg

    if (Math.abs(diff) < 10) return 'stable' // 差異小於 10 認為稳定
    return diff > 0 ? 'increasing' : 'decreasing'
  }

  /**
   * 計算置信度等级
   * 综合考慮提交數和工作天數兩個維度
   */
  private static calculateConfidence(commits: number, workDays: number): 'high' | 'medium' | 'low' {
    // 高置信：提交數≥100 且 工作天數≥10
    if (commits >= 100 && workDays >= 10) {
      return 'high'
    }

    // 中置信：提交數≥50 或 工作天數≥5
    if (commits >= 50 || workDays >= 5) {
      return 'medium'
    }

    // 低置信：提交數<50 且 工作天數<5
    return 'low'
  }
}
