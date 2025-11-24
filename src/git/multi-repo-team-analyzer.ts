import { GitLogOptions, TeamAnalysis } from '../types/git-types'
import {
  UserPatternCollector,
  ContributorInfo,
  UserPatternData,
  DailyCommitTime,
} from './collectors/user-pattern-collector'
import { UserAnalyzer } from '../core/user-analyzer'

/**
 * 聚合的貢獻者資訊（跨多個儲存庫）
 */
interface AggregatedContributor {
  email: string
  name: string
  totalCommits: number // 所有儲存庫的總提交數
  repos: Array<{ path: string; commits: number }> // 在各個儲存庫的提交數
}

/**
 * 多儲存庫團隊分析器
 * 負責聚合多個儲存庫的資料並進行統一的團隊分析
 */
export class MultiRepoTeamAnalyzer {
  /**
   * 分析多個儲存庫的團隊工作模式（聚合模式）
   * @param repoPaths 所有儲存庫路徑
   * @param options Git日誌選項
   * @param minCommits 最小提交數閾值（預設20）
   * @param maxUsers 最大分析使用者數（預設30）
   * @param overallIndex 整體996指數（用於對比）
   */
  static async analyzeAggregatedTeam(
    repoPaths: string[],
    options: GitLogOptions,
    minCommits: number = 20,
    maxUsers: number = 30,
    overallIndex: number = 0
  ): Promise<TeamAnalysis | null> {
    // 第一步：蒐集所有儲存庫的所有貢獻者
    const aggregatedContributors = await this.aggregateContributors(repoPaths, options)

    // 第二步：過濾核心貢獻者（總提交數 >= minCommits）
    const coreContributors = Array.from(aggregatedContributors.values())
      .filter((c) => c.totalCommits >= minCommits)
      .sort((a, b) => b.totalCommits - a.totalCommits)
      .slice(0, maxUsers)

    if (coreContributors.length < 2) {
      console.log(`\n  核心貢獻者數量不足（${coreContributors.length}人），跳過團隊分析\n`)
      return null
    }

    // 第三步：為每個核心貢獻者跨儲存庫採集資料
    const userPatternDataList = await this.aggregateUserDataAcrossRepos(coreContributors, repoPaths, options)

    // 第四步：計算總提交數（用於計算百分比）
    const totalCommits = coreContributors.reduce((sum, c) => sum + c.totalCommits, 0)

    // 第五步：分析每個使用者
    const userPatterns = userPatternDataList.map((userData) => UserAnalyzer.analyzeUser(userData, totalCommits))

    // 第六步：團隊層面分析
    const teamAnalysis = UserAnalyzer.analyzeTeam(userPatterns, minCommits, aggregatedContributors.size, overallIndex)

    return teamAnalysis
  }

  /**
   * 聚合所有儲存庫的貢獻者資訊
   */
  private static async aggregateContributors(
    repoPaths: string[],
    options: GitLogOptions
  ): Promise<Map<string, AggregatedContributor>> {
    const aggregated = new Map<string, AggregatedContributor>()
    const collector = new UserPatternCollector()

    for (const repoPath of repoPaths) {
      try {
        const contributors = await collector.getAllContributors({ ...options, path: repoPath })

        for (const c of contributors) {
          if (!aggregated.has(c.email)) {
            aggregated.set(c.email, {
              email: c.email,
              name: c.name,
              totalCommits: 0,
              repos: [],
            })
          }

          const agg = aggregated.get(c.email)!
          agg.totalCommits += c.commits
          agg.repos.push({ path: repoPath, commits: c.commits })
        }
      } catch (error) {
        // 跳過無法存取的儲存庫
        console.error(`⚠️  無法存取儲存庫 ${repoPath}:`, error)
      }
    }

    return aggregated
  }

  /**
   * 為每個核心貢獻者跨儲存庫聚合資料
   */
  private static async aggregateUserDataAcrossRepos(
    coreContributors: AggregatedContributor[],
    repoPaths: string[],
    options: GitLogOptions
  ): Promise<UserPatternData[]> {
    const results: UserPatternData[] = []
    const collector = new UserPatternCollector()

    for (const contributor of coreContributors) {
      // 初始化聚合資料
      const timeDistribution = new Array(24).fill(0).map((_, i) => ({
        time: i.toString().padStart(2, '0'),
        count: 0,
      }))

      const dayDistribution = new Array(7).fill(0).map((_, i) => ({
        time: (i + 1).toString(),
        count: 0,
      }))

      const allDailyFirstCommits: DailyCommitTime[] = []
      const allDailyLatestCommits: DailyCommitTime[] = []

      // 遍歷所有儲存庫，聚合該使用者的資料
      for (const repoPath of repoPaths) {
        try {
          const [timeData, dayData, firstCommits, latestCommits] = await Promise.all([
            collector.getUserTimeDistribution(contributor.email, { ...options, path: repoPath }),
            collector.getUserDayDistribution(contributor.email, { ...options, path: repoPath }),
            collector.getUserDailyFirstCommits(contributor.email, { ...options, path: repoPath }, 6), // 團隊工作模式用6個月
            collector.getUserDailyLatestCommits(contributor.email, { ...options, path: repoPath }, 6),
          ])

          // 合併時間分布
          for (let i = 0; i < 24; i++) {
            timeDistribution[i].count += timeData[i]?.count || 0
          }

          // 合併星期分布
          for (let i = 0; i < 7; i++) {
            dayDistribution[i].count += dayData[i]?.count || 0
          }

          // 合併每日首末提交時間
          allDailyFirstCommits.push(...firstCommits)
          allDailyLatestCommits.push(...latestCommits)
        } catch (error) {
          // 跳過該儲存庫
          console.error(`⚠️  無法為使用者 ${contributor.email} 採集儲存庫 ${repoPath} 的資料`)
        }
      }

      // 建構ContributorInfo
      const contributorInfo: ContributorInfo = {
        author: `${contributor.name} <${contributor.email}>`,
        email: contributor.email,
        name: contributor.name,
        commits: contributor.totalCommits,
      }

      results.push({
        contributor: contributorInfo,
        timeDistribution,
        dayDistribution,
        dailyFirstCommits: allDailyFirstCommits,
        dailyLatestCommits: allDailyLatestCommits,
      })
    }

    return results
  }
}
