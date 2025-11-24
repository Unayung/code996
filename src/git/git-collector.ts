import { GitLogOptions, GitLogData } from '../types/git-types'
import chalk from 'chalk'
import { BaseCollector } from './collectors/base-collector'
import { TimeCollector } from './collectors/time-collector'
import { CommitCollector } from './collectors/commit-collector'
import { ContributorCollector } from './collectors/contributor-collector'
import { TimezoneCollector } from './collectors/timezone-collector'

/**
 * Git資料採集主類
 * 整合所有專門的採集器，提供統一的資料蒐集接口
 */
export class GitCollector extends BaseCollector {
  private timeCollector: TimeCollector
  private commitCollector: CommitCollector
  private contributorCollector: ContributorCollector
  private timezoneCollector: TimezoneCollector

  constructor() {
    super()
    this.timeCollector = new TimeCollector()
    this.commitCollector = new CommitCollector()
    this.contributorCollector = new ContributorCollector()
    this.timezoneCollector = new TimezoneCollector()
  }

  /**
   * 統計符合過濾條件的 commit 數量
   */
  async countCommits(options: GitLogOptions): Promise<number> {
    return this.contributorCollector.countCommits(options)
  }

  /**
   * 獲取最早的commit時間
   */
  async getFirstCommitDate(options: GitLogOptions): Promise<string> {
    return this.contributorCollector.getFirstCommitDate(options)
  }

  /**
   * 獲取最新的commit時間
   */
  async getLastCommitDate(options: GitLogOptions): Promise<string> {
    return this.contributorCollector.getLastCommitDate(options)
  }

  /**
   * 蒐集Git資料
   * @param options 採集選項
   * @returns 完整的Git日誌資料
   */
  async collect(options: GitLogOptions): Promise<GitLogData> {
    if (!options.silent) {
      console.log(chalk.blue(`正在分析儲存庫: ${options.path}`))
    }

    // 檢查是否為有效的Git儲存庫
    if (!(await this.isValidGitRepo(options.path))) {
      throw new Error(`路徑 "${options.path}" 不是一個有效的Git儲存庫`)
    }

    try {
      const [
        byHour,
        byDay,
        totalCommits,
        dailyFirstCommits,
        dayHourCommits,
        dailyLatestCommits,
        dailyCommitHours,
        dailyCommitCounts,
        contributors,
        firstCommitDate,
        lastCommitDate,
        timezoneData,
      ] = await Promise.all([
        this.timeCollector.getCommitsByHour(options),
        this.timeCollector.getCommitsByDay(options),
        this.contributorCollector.countCommits(options),
        this.commitCollector.getDailyFirstCommits(options),
        this.commitCollector.getCommitsByDayAndHour(options),
        this.commitCollector.getDailyLatestCommits(options),
        this.commitCollector.getDailyCommitHours(options),
        this.commitCollector.getDailyCommitCounts(options),
        this.contributorCollector.getContributorCount(options),
        this.contributorCollector.getFirstCommitDate(options),
        this.contributorCollector.getLastCommitDate(options),
        this.timezoneCollector.collectTimezones(options),
      ])

      if (!options.silent) {
        console.log(chalk.green(`資料採集完成: ${totalCommits} 個commit`))
      }

      return {
        byHour,
        byDay,
        totalCommits,
        dailyFirstCommits: dailyFirstCommits.length > 0 ? dailyFirstCommits : undefined,
        dayHourCommits: dayHourCommits.length > 0 ? dayHourCommits : undefined,
        dailyLatestCommits: dailyLatestCommits.length > 0 ? dailyLatestCommits : undefined,
        dailyCommitHours: dailyCommitHours.length > 0 ? dailyCommitHours : undefined,
        dailyCommitCounts: dailyCommitCounts.length > 0 ? dailyCommitCounts : undefined,
        contributors,
        firstCommitDate: firstCommitDate || undefined,
        lastCommitDate: lastCommitDate || undefined,
        granularity: 'half-hour', // 標識資料為半小時粒度
        timezoneData,
      }
    } catch (error) {
      if (!options.silent) {
        console.error(chalk.red(`資料採集失敗: ${(error as Error).message}`))
      }
      throw error
    }
  }
}
