import { GitLogOptions, TeamAnalysis } from '../types/git-types'
import { UserPatternCollector } from './collectors/user-pattern-collector'
import { UserAnalyzer } from '../core/user-analyzer'
import ora from 'ora'

/**
 * Git團隊分析器
 * 整合使用者模式採集和團隊分析的完整流程
 */
export class GitTeamAnalyzer {
  /**
   * 分析團隊工作模式
   * @param options Git日誌選項
   * @param overallIndex 專案整體996指數（用於對比）
   * @param minCommits 最小提交數閾值（預設20）
   * @param maxUsers 最大分析使用者數（預設30）
   * @param silent 是否靜默模式（不顯示進度）
   * @returns 團隊分析結果，如果貢獻者不足則傳回null
   */
  static async analyzeTeam(
    options: GitLogOptions,
    overallIndex: number,
    minCommits: number = 20,
    maxUsers: number = 30,
    silent: boolean = false
  ): Promise<TeamAnalysis | null> {
    const collector = new UserPatternCollector()

    // 1. 獲取所有貢獻者列表
    const spinner = !silent ? ora('正在獲取貢獻者列表...').start() : null
    const allContributors = await collector.getAllContributors(options)

    if (allContributors.length === 0) {
      spinner?.fail('未找到任何貢獻者')
      return null
    }

    // 2. 過濾核心貢獻者
    const coreContributors = collector.filterCoreContributors(allContributors, minCommits, maxUsers)

    if (coreContributors.length < 3) {
      // 貢獻者太少，不適合進行團隊分析
      spinner?.info(`核心貢獻者數量不足（${coreContributors.length}人），跳過團隊分析`)
      return null
    }

    spinner?.succeed(`找到 ${allContributors.length} 位貢獻者，篩選出 ${coreContributors.length} 位核心成員`)

    // 3. 批量採集使用者工作模式資料
    const dataSpinner = !silent ? ora('正在採集使用者工作模式資料...').start() : null

    const userPatternDataList = await collector.collectUserPatterns(coreContributors, options)

    dataSpinner?.succeed(`成功採集 ${userPatternDataList.length} 位使用者的工作模式資料`)

    // 4. 分析每個使用者的工作模式
    const analysisSpinner = !silent ? ora('正在分析使用者工作模式...').start() : null

    const totalCommits = allContributors.reduce((sum, c) => sum + c.commits, 0)
    const userPatterns = userPatternDataList.map((data) => UserAnalyzer.analyzeUser(data, totalCommits))

    analysisSpinner?.succeed(`成功分析 ${userPatterns.length} 位使用者的工作模式`)

    // 5. 進行團隊級別的統計和聚類
    const teamSpinner = !silent ? ora('正在進行團隊統計和聚類...').start() : null

    const teamAnalysis = UserAnalyzer.analyzeTeam(userPatterns, minCommits, allContributors.length, overallIndex)

    teamSpinner?.succeed('團隊分析完成')

    return teamAnalysis
  }

  /**
   * 檢查是否應該執行團隊分析
   * @param options 分析選項
   * @returns true 如果應該執行團隊分析，false 否則
   */
  static shouldAnalyzeTeam(options: {
    self?: boolean // 是否只分析自己
    skipUserAnalysis?: boolean // 是否跳過使用者分析
  }): boolean {
    // 如果是 --self 模式或顯式跳過，則不執行團隊分析
    if (options.self || options.skipUserAnalysis) {
      return false
    }

    return true
  }
}

