import chalk from 'chalk'
import ora from 'ora'
import { RepoScanner } from '../../workspace/repo-scanner'
import { promptRepoSelection } from '../prompts/repo-selector'
import { GitCollector } from '../../git/git-collector'
import { GitParser } from '../../git/git-parser'
import { GitDataMerger } from '../../git/git-data-merger'
import { GitTeamAnalyzer } from '../../git/git-team-analyzer'
import { MultiRepoTeamAnalyzer } from '../../git/multi-repo-team-analyzer'
import { TrendAnalyzer } from '../../core/trend-analyzer'
import { TimezoneAnalyzer } from '../../core/timezone-analyzer'
import { ProjectClassifier, ProjectType } from '../../core/project-classifier'
import { AnalyzeOptions, GitLogData, RepoAnalysisRecord, RepoInfo, GitLogOptions } from '../../types/git-types'
import { resetWorkdayChecker } from '../../utils/workday-checker'
import { calculateTimeRange, getTerminalWidth, createAdaptiveTable } from '../../utils/terminal'
import {
  printCoreResults,
  printDetailedAnalysis,
  printWorkTimeSummary,
  printTimeDistribution,
  printWeekdayOvertime,
  printWeekendOvertime,
  printLateNightAnalysis,
  MultiComparisonPrinter,
} from './report'
import { printTrendReport } from './report/trend-printer'
import { printTeamAnalysis } from './report/printers/user-analysis-printer'

/**
 * 判斷是否應該啟用節假日調休模式
 * @param options 使用者選項
 * @returns 是否啟用及原因
 */
function shouldEnableHolidayMode(options: AnalyzeOptions): { enabled: boolean; reason: string } {
  // 只有在使用者明確使用 --cn 参數時才啟用
  if (options.cn) {
    return {
      enabled: true,
      reason: '原因：使用者通過 --cn 参數強制開啟',
    }
  }

  // 預設不啟用（固定週休二日）
  return {
    enabled: false,
    reason: '',
  }
}

/**
 * 多儲存庫分析執行器
 * 負責多儲存庫分析的整體流程（智慧模式的一部分）
 */
export class MultiExecutor {
  /**
   * 執行多儲存庫分析
   * @param inputDirs 使用者指定的目錄列表（為空則掃描目前目錄的子目錄）
   * @param options 分析選項
   * @param preScannedRepos 可選：已經掃描好的儲存庫列表（智慧模式使用）
   */
  static async execute(inputDirs: string[], options: AnalyzeOptions, preScannedRepos?: RepoInfo[]): Promise<void> {
    try {
      // ========== 步骤 1: 掃描儲存庫 ==========
      let repos: RepoInfo[]

      if (preScannedRepos && preScannedRepos.length > 0) {
        // 使用已掃描的儲存庫列表（來自智慧模式）
        repos = preScannedRepos
        console.log(chalk.green(`✔ 已檢測到 ${repos.length} 個候選儲存庫`))
      } else {
        // 重新掃描
        const spinner = ora('🔍 正在掃描 Git 儲存庫...').start()

        try {
          if (inputDirs.length === 0) {
            repos = await RepoScanner.scanSubdirectories(process.cwd())
          } else {
            repos = await RepoScanner.scan(inputDirs)
          }
          spinner.succeed(`掃描完成，发現 ${repos.length} 個候選儲存庫`)
        } catch (error) {
          spinner.fail('掃描失敗')
          console.error(chalk.red('❌ 掃描失敗:'), (error as Error).message)
          return
        }

        if (repos.length === 0) {
          console.log(chalk.yellow('⚠️ 未在提供的目錄中找到 Git 儲存庫。'))
          return
        }
      }

      console.log(chalk.gray(`可選擇的儲存庫總數: ${repos.length} 個`))
      console.log()

      // ========== 步骤 2: 交互式選擇儲存庫 ==========
      const selectedRepos = await promptRepoSelection(repos)

      if (selectedRepos.length === 0) {
        console.log(chalk.yellow('⚠️ 未選擇任何儲存庫，分析已取消。'))
        return
      }

      console.log()
      console.log(chalk.blue(`📦 開始分析 ${selectedRepos.length} 個儲存庫（串行執行）`))
      console.log()

      // 创建 collector 實例
      const collector = new GitCollector()

      // 解析作者過濾（優先 --author，其次 --self）
      let authorPattern: string | undefined
      if (options.author) {
        authorPattern = options.author
        console.log(chalk.blue('🙋 作者過濾:'), `僅包含作者: ${options.author}`)
        console.log(chalk.gray('   將在所有儲存庫中只統計符合該模式的作者的提交'))
        console.log()
      } else if (options.self) {
        try {
          const authorInfo = await collector.resolveSelfAuthor(selectedRepos[0].path)
          authorPattern = authorInfo.pattern
          console.log(chalk.blue('🙋 作者過濾:'), authorInfo.displayLabel)
          console.log(chalk.gray('   將在所有儲存庫中只統計該作者的提交'))
          console.log()
        } catch (error) {
          console.error(chalk.red('❌ 解析目前使用者資訊失敗:'), (error as Error).message)
          return
        }
      }

      // 計算時間範圍
      let effectiveSince: string | undefined
      let effectiveUntil: string | undefined

      if (options.allTime || options.year || options.since || options.until) {
        // 使用者明确指定了時間範圍，使用指定的範圍
        const range = this.resolveTimeRange(options)
        effectiveSince = range.since
        effectiveUntil = range.until
      } else {
        // 預設：找到所有儲存庫中最新的提交，從那個時間回溯 1 年
        const spinner2 = ora('🔍 正在檢測儲存庫時間範圍...').start()
        try {
          const latestDate = await this.findLatestCommitDate(selectedRepos, collector)
          if (latestDate) {
            const untilDate = new Date(latestDate + 'T00:00:00Z')
            const sinceDate = new Date(untilDate.getTime())
            sinceDate.setUTCDate(sinceDate.getUTCDate() - 365)

            effectiveSince = this.formatUTCDate(sinceDate)
            effectiveUntil = this.formatUTCDate(untilDate)

            spinner2.succeed(`檢測到最新提交: ${latestDate}`)
            console.log(chalk.gray(`💡 提示: 預設從最新提交回溯 1 年，可使用 --all-time 或 -y 自定義`))
          } else {
            spinner2.warn('未能檢測到提交，將使用所有時間')
          }
        } catch {
          spinner2.warn('檢測失敗，將使用所有時間')
        }
      }

      // 顯示時間範圍資訊
      if (!effectiveSince && !effectiveUntil) {
        console.log(chalk.blue('📅 分析時段: 所有時間'))
      } else {
        console.log(chalk.blue(`📅 分析時段: ${effectiveSince || '最早'} 至 ${effectiveUntil || '最新'}`))
      }
      console.log()

      // ========== 步骤 3: 批量採集資料 ==========
      const dataList: GitLogData[] = []
      const repoRecords: RepoAnalysisRecord[] = []

      for (let i = 0; i < selectedRepos.length; i++) {
        const repo = selectedRepos[i]
        const progress = `(${i + 1}/${selectedRepos.length})`

        console.log(chalk.cyan(`${progress} 正在分析: ${repo.name}`))

        try {
          const data = await collector.collect({
            path: repo.path,
            since: effectiveSince,
            until: effectiveUntil,
            authorPattern,
            timezone: options.timezone, // 添加時區過濾参數
            silent: true,
          })

          dataList.push(data)

          // 為每個儲存庫計算 996 指數（用於後續對比表）
          const shouldEnableHoliday2 = shouldEnableHolidayMode(options) // 本地變數以避免混淆
          const parsedData = await GitParser.parseGitData(
            data,
            options.hours,
            effectiveSince,
            effectiveUntil,
            shouldEnableHoliday2.enabled
          )
          const result = GitParser.calculate996Index(parsedData)

          // 專案類型識別
          const classification = ProjectClassifier.classify(data, parsedData)

          repoRecords.push({
            repo,
            data,
            result,
            status: 'success',
            classification,
          })

          console.log(chalk.green(`    ✓ ${data.totalCommits} 個提交, 996指數: ${result.index996.toFixed(1)}`))
        } catch (error) {
          console.error(chalk.red(`    ✗ 分析失敗: ${(error as Error).message}`))
          repoRecords.push({
            repo,
            data: { byHour: [], byDay: [], totalCommits: 0 },
            result: { index996: 0, index996Str: '未知', overTimeRadio: 0 },
            status: 'failed',
            error: (error as Error).message,
          })
        }
      }

      // 過濾出成功的資料
      const successfulData = dataList.filter((_, index) => repoRecords[index].status === 'success')

      if (successfulData.length === 0) {
        console.log()
        console.log(chalk.red('❌ 所有儲存庫分析均失敗，無法生成彙總報告'))
        return
      }

      console.log()
      console.log(chalk.green(`✓ 成功分析 ${successfulData.length}/${selectedRepos.length} 個儲存庫`))
      console.log()

      // ========== 步骤 4: 合併資料 ==========
      const spinner2 = ora('📊 正在合併資料...').start()
      const mergedData = GitDataMerger.merge(successfulData)
      spinner2.succeed('資料合併完成')
      console.log()

      // 顯示時區過濾提示（如果有）
      if (options.timezone) {
        console.log(chalk.blue('⚙️  時區過濾已啟用'))
        console.log(chalk.gray(`目標時區: ${options.timezone}`))
        console.log(chalk.gray(`過濾後總提交數: ${mergedData.totalCommits}`))
        console.log()
      }

      // ========== 步骤 5: 分析合併後的資料 ==========
      const spinner3 = ora('📈 正在計算996指數...').start()
      const shouldEnableHoliday3 = shouldEnableHolidayMode(options) // 本地變數以避免混淆
      const parsedData = await GitParser.parseGitData(
        mergedData,
        options.hours,
        effectiveSince,
        effectiveUntil,
        shouldEnableHoliday3.enabled
      )
      const result = GitParser.calculate996Index(parsedData)
      spinner3.succeed('分析完成！')
      console.log()

      // ========== 步骤 5.5: 檢查是否有開源專案 ==========
      const hasOpenSourceProject = repoRecords.some(
        (record) => record.classification && record.classification.projectType === ProjectType.OPEN_SOURCE
      )

      // 如果有任意一個開源專案，顯示專案類型對比表
      if (hasOpenSourceProject) {
        this.printProjectTypeComparison(repoRecords)
      }

      // ========== 步骤 6: 輸出彙總結果 ==========
      console.log(chalk.cyan.bold('📊 多儲存庫彙總分析報告:'))
      console.log()

      // 顯示節假日調休模式提示
      if (shouldEnableHoliday3.enabled) {
        console.log(chalk.blue('🇨🇳 已啟用中國節假日調休判斷'))
        console.log(chalk.gray(`${shouldEnableHoliday3.reason}`))
        console.log()
      }

      // 如果有開源專案，隐藏核心結果、詳細分析和工作時間推測
      if (!hasOpenSourceProject) {
        printCoreResults(result, mergedData, options, effectiveSince, effectiveUntil)
        printDetailedAnalysis(result, parsedData)
        printWorkTimeSummary(parsedData)
      }

      printTimeDistribution(parsedData, options.halfHour) // 傳遞半小時模式参數
      printWeekdayOvertime(parsedData)
      printWeekendOvertime(parsedData)
      printLateNightAnalysis(parsedData)

      // ========== 步骤 7: 輸出各儲存庫對比表 ==========
      MultiComparisonPrinter.print(repoRecords)

      // ========== 步骤 8: 月度趨勢分析（預設啟用） ==========
      if (selectedRepos.length > 0) {
        console.log()
        const trendSpinner = ora('📈 正在進行多儲存庫彙總月度趨勢分析...').start()
        try {
          // 提取所有成功分析的儲存庫路径
          const successfulRepoPaths = selectedRepos
            .filter((_, index) => repoRecords[index].status === 'success')
            .map((repo) => repo.path)

          if (successfulRepoPaths.length === 0) {
            trendSpinner.warn('沒有成功的儲存庫資料，跳過趨勢分析')
          } else {
            // 使用新的多儲存庫彙總趨勢分析方法
            const trendResult = await TrendAnalyzer.analyzeMultiRepoTrend(
              successfulRepoPaths,
              effectiveSince ?? null,
              effectiveUntil ?? null,
              authorPattern,
              (current, total, month) => {
                // 實時更新進度
                trendSpinner.text = `📈 正在分析月度趨勢... (${current}/${total}: ${month})`
              },
              options.timezone, // 傳遞時區過濾参數
              shouldEnableHoliday3.enabled // 傳遞節假日調休模式参數
            )
            trendSpinner.succeed()
            printTrendReport(trendResult)
          }
        } catch (error) {
          trendSpinner.fail('趨勢分析失敗')
          console.error(chalk.red('⚠️  趨勢分析錯誤:'), (error as Error).message)
        }
      }

      // ========== 步骤 9: 團隊工作模式分析（聚合所有儲存庫的資料）==========
      // 開源專案不顯示團隊工作模式分析
      if (!hasOpenSourceProject && GitTeamAnalyzer.shouldAnalyzeTeam(options) && selectedRepos.length > 0) {
        // 蒐集所有成功分析的儲存庫路径
        const successfulRepoPaths = selectedRepos
          .filter((_, index) => repoRecords[index].status === 'success')
          .map((repo) => repo.path)

        if (successfulRepoPaths.length > 0) {
          console.log()
          console.log(chalk.gray(`💡 聚合 ${successfulRepoPaths.length} 個儲存庫的資料進行團隊工作模式分析`))

          try {
            const collectOptions: GitLogOptions = {
              path: '', // 多儲存庫模式下不需要單個path
              since: effectiveSince,
              until: effectiveUntil,
              authorPattern,
              ignoreAuthor: options.ignoreAuthor,
              ignoreMsg: options.ignoreMsg,
            }

            const maxUsers = options.maxUsers ? parseInt(String(options.maxUsers), 10) : 30
            const teamAnalysis = await MultiRepoTeamAnalyzer.analyzeAggregatedTeam(
              successfulRepoPaths,
              collectOptions,
              20, // minCommits（所有儲存庫總計≥20）
              maxUsers,
              result.index996 // 整體996指數
            )

            if (teamAnalysis) {
              printTeamAnalysis(teamAnalysis)
            }
          } catch (error) {
            console.log(chalk.yellow('⚠️  團隊分析失敗:'), (error as Error).message)
          }
        }
      }

      // ========== 步骤 10: 檢測跨時區並顯示警告（如果未使用 --timezone 過濾）==========
      if (mergedData.timezoneData && !options.timezone) {
        const tzAnalysis = TimezoneAnalyzer.analyzeTimezone(mergedData.timezoneData, mergedData.byHour)
        if (tzAnalysis.isCrossTimezone) {
          console.log()
          const warningMessage = TimezoneAnalyzer.generateWarningMessage(tzAnalysis)
          console.log(chalk.yellow(warningMessage))
        }
      }
    } catch (error) {
      console.error(chalk.red('❌ 多儲存庫分析失敗:'), (error as Error).message)
      process.exit(1)
    }
  }

  /**
   * 打印專案類型對比表格
   */
  private static printProjectTypeComparison(repoRecords: RepoAnalysisRecord[]): void {
    console.log(chalk.yellow.bold('🌍 專案類型檢測結果'))
    console.log()

    const terminalWidth = Math.min(getTerminalWidth(), 120)
    const typeTable = createAdaptiveTable(terminalWidth, 'stats', {}, [30, terminalWidth - 35])

    // 表头
    typeTable.push([
      { content: chalk.yellow(chalk.bold('儲存庫名称')), colSpan: 1 },
      { content: chalk.yellow(chalk.bold('專案類型')), colSpan: 1 },
    ])

    // 資料行
    for (const record of repoRecords) {
      if (record.status === 'success' && record.classification) {
        const { projectType, confidence } = record.classification
        let typeText = ''
        let typeEmoji = ''

        if (projectType === ProjectType.OPEN_SOURCE) {
          typeEmoji = '🌍'
          typeText = `開源專案 (置信度: ${confidence}%)`
        } else if (projectType === ProjectType.CORPORATE) {
          typeEmoji = '🏢'
          typeText = `公司專案 (置信度: ${confidence}%)`
        } else {
          typeEmoji = '❓'
          typeText = `不確定 (置信度: ${confidence}%)`
        }

        typeTable.push([
          { content: chalk.yellow(`${typeEmoji} ${record.repo.name}`), colSpan: 1 },
          { content: chalk.yellow(typeText), colSpan: 1 },
        ])
      }
    }

    console.log(typeTable.toString())
    console.log()

    // 如果有開源專案，顯示提示
    const openSourceCount = repoRecords.filter(
      (r) => r.classification && r.classification.projectType === ProjectType.OPEN_SOURCE
    ).length

    if (openSourceCount > 0) {
      console.log(chalk.yellow('💡 提示：'))
      console.log(chalk.yellow(`   檢測到 ${openSourceCount} 個開源專案。開源專案的週末和晚間提交是正常的社区貢獻。`))
      console.log(chalk.yellow('   彙總報告不會顯示"996指數"和"加班分析"等不適用的指標。'))
      console.log()
    }
  }

  /**
   * 找到所有儲存庫中最新的提交日期
   */
  private static async findLatestCommitDate(repos: RepoInfo[], collector: GitCollector): Promise<string | null> {
    let latestDate: string | null = null

    for (const repo of repos) {
      try {
        const lastDate = await collector.getLastCommitDate({ path: repo.path })
        if (lastDate && (!latestDate || lastDate > latestDate)) {
          latestDate = lastDate
        }
      } catch {
        // 忽略單個儲存庫的錯誤
      }
    }

    return latestDate
  }

  /**
   * 格式化 UTC 日期為 YYYY-MM-DD
   */
  private static formatUTCDate(date: Date): string {
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  /**
   * 解析時間範圍（用於使用者明确指定時）
   */
  private static resolveTimeRange(options: AnalyzeOptions): { since?: string; until?: string } {
    // 如果明确指定了 --all-time
    if (options.allTime) {
      return {}
    }

    // 如果指定了年份
    if (options.year) {
      const yearRange = this.parseYearOption(options.year)
      if (yearRange) {
        return {
          since: yearRange.since,
          until: yearRange.until,
        }
      }
    }

    // 如果指定了 since 或 until
    if (options.since || options.until) {
      const fallback = calculateTimeRange(false)
      return {
        since: options.since || fallback.since,
        until: options.until || fallback.until,
      }
    }

    return {}
  }

  /**
   * 解析 --year 参數
   */
  private static parseYearOption(yearStr: string): { since: string; until: string } | null {
    yearStr = yearStr.trim()

    // 匹配年份範圍格式：2023-2025
    const rangeMatch = yearStr.match(/^(\d{4})-(\d{4})$/)
    if (rangeMatch) {
      const startYear = parseInt(rangeMatch[1], 10)
      const endYear = parseInt(rangeMatch[2], 10)

      if (startYear < 1970 || endYear < 1970 || startYear > endYear) {
        console.error(chalk.red('❌ 年份格式錯誤: 起始年份不能大於結束年份，且年份必須 >= 1970'))
        process.exit(1)
      }

      return {
        since: `${startYear}-01-01`,
        until: `${endYear}-12-31`,
      }
    }

    // 匹配單年格式：2025
    const singleMatch = yearStr.match(/^(\d{4})$/)
    if (singleMatch) {
      const year = parseInt(singleMatch[1], 10)

      if (year < 1970) {
        console.error(chalk.red('❌ 年份格式錯誤: 年份必須 >= 1970'))
        process.exit(1)
      }

      return {
        since: `${year}-01-01`,
        until: `${year}-12-31`,
      }
    }

    console.error(chalk.red('❌ 年份格式錯誤: 請使用 YYYY 格式（如 2025）或 YYYY-YYYY 格式（如 2023-2025）'))
    process.exit(1)
  }
}
