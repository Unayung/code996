import chalk from 'chalk'
import ora from 'ora'
import { GitCollector } from '../../git/git-collector'
import { GitParser } from '../../git/git-parser'
import { TrendAnalyzer } from '../../core/trend-analyzer'
import { TimezoneAnalyzer } from '../../core/timezone-analyzer'
import { GitTeamAnalyzer } from '../../git/git-team-analyzer'
import { ProjectClassifier, ProjectType } from '../../core/project-classifier'
import { AnalyzeOptions } from '../index'
import { calculateTimeRange, getTerminalWidth, createAdaptiveTable } from '../../utils/terminal'
import { GitLogData, GitLogOptions, ParsedGitData, Result996 } from '../../types/git-types'
import { resetWorkdayChecker } from '../../utils/workday-checker'
import {
  printCoreResults,
  printDetailedAnalysis,
  printWorkTimeSummary,
  printTimeDistribution,
  printWeekdayOvertime,
  printWeekendOvertime,
  printLateNightAnalysis,
} from './report'
import { printTrendReport } from './report/trend-printer'
import { printTeamAnalysis } from './report/printers/user-analysis-printer'
import { ensureCommitSamples } from '../common/commit-guard'

type TimeRangeMode = 'all-time' | 'custom' | 'auto-last-commit' | 'fallback'

interface AuthorFilterInfo {
  pattern: string
  displayLabel: string
}

/** 分析執行器，集中處理採集、解析與渲染流程 */
export class AnalyzeExecutor {
  /** 執行分析的主流程 */
  static async execute(path: string, options: AnalyzeOptions): Promise<void> {
    try {
      // 重置 WorkdayChecker 以應用新的配置
      resetWorkdayChecker()

      const collector = new GitCollector()

      // 計算時間範圍：优先使用使用者輸入，其次按最後一次提交回溯365天，最後退回到目前時間
      const {
        since: effectiveSince,
        until: effectiveUntil,
        mode: rangeMode,
        note: rangeNote,
      } = await resolveTimeRange({ collector, path, options })

      // 顯示分析開始資訊
      console.log(chalk.blue('🔍 分析儲存庫:'), path || process.cwd())
      switch (rangeMode) {
        case 'all-time':
          console.log(chalk.blue('📅 時間範圍:'), '所有時間')
          break
        case 'custom':
          console.log(chalk.blue('📅 時間範圍:'), `${effectiveSince} 至 ${effectiveUntil}`)
          break
        case 'auto-last-commit':
          console.log(
            chalk.blue('📅 時間範圍:'),
            `${effectiveSince} 至 ${effectiveUntil}${rangeNote ? `（${rangeNote}）` : ''}`
          )
          break
        default:
          console.log(chalk.blue('📅 時間範圍:'), `${effectiveSince} 至 ${effectiveUntil}（按目前日期回溯）`)
      }
      console.log()

      let authorFilter: AuthorFilterInfo | undefined

      // 優先處理 --author 選項，其次是 --self
      if (options.author) {
        authorFilter = {
          pattern: options.author,
          displayLabel: `僅包含作者: ${options.author}`,
        }
        console.log(chalk.blue('🙋 作者過濾:'), authorFilter.displayLabel)
        console.log()
      } else if (options.self) {
        authorFilter = await resolveAuthorFilter(collector, path)
        console.log(chalk.blue('🙋 作者過濾:'), authorFilter.displayLabel)
        console.log()
      }

      // 建構統一的 Git 採集参數，保證所有步骤使用一致的過濾條件
      const collectOptions: GitLogOptions = {
        path,
        since: effectiveSince,
        until: effectiveUntil,
        authorPattern: authorFilter?.pattern,
        ignoreAuthor: options.ignoreAuthor,
        ignoreMsg: options.ignoreMsg,
        timezone: options.timezone, // 添加時區過濾参數
      }

      // 在正式分析前，先檢查 commit 樣本量是否達到最低要求
      const hasEnoughCommits = await ensureCommitSamples(collector, collectOptions, 50, '分析')
      if (!hasEnoughCommits) {
        return
      }

      // 创建進度指示器
      const spinner = ora('📦 開始分析').start()

      // 步骤1: 資料採集（時區過濾已在採集阶段完成）
      const rawData = await collector.collect(collectOptions)
      spinner.text = '⚙️ 正在解析資料...'
      spinner.render()

      // 步骤2: 資料解析與驗證
      const shouldEnableHoliday = shouldEnableHolidayMode(rawData, options)
      const parsedData = await GitParser.parseGitData(
        rawData,
        options.hours,
        effectiveSince,
        effectiveUntil,
        shouldEnableHoliday.enabled
      )
      const validation = GitParser.validateData(parsedData)

      if (!validation.isValid) {
        spinner.fail('資料驗證失敗')
        console.log(chalk.red('❌ 发現以下錯誤:'))
        validation.errors.forEach((error) => {
          console.log(`  ${chalk.red('•')} ${error}`)
        })
        process.exit(1)
      }

      spinner.text = '📈 正在計算996指數...'
      spinner.render()

      // 步骤3: 計算996指數
      const result = GitParser.calculate996Index(parsedData)

      spinner.succeed('分析完成！')
      console.log()

      // 顯示時區過濾提示（如果有）
      if (options.timezone) {
        console.log(chalk.blue('⚙️  時區過濾已啟用'))
        console.log(chalk.gray(`目標時區: ${options.timezone}`))
        console.log(chalk.gray(`過濾後提交數: ${rawData.totalCommits}`))
        console.log()
      }

      // ========== 專案類型識別 ==========
      const classification = ProjectClassifier.classify(rawData, parsedData)
      if (classification.projectType === ProjectType.OPEN_SOURCE) {
        printOpenSourceProjectWarning(classification)
        console.log()
      }

      // ========== 顯示節假日調休模式提示 ==========
      if (shouldEnableHoliday.enabled) {
        console.log(chalk.blue('🇨🇳 已啟用中國節假日調休判斷'))
        console.log(chalk.gray(`${shouldEnableHoliday.reason}`))
        console.log()
      }

      // 若未指定時間範圍，嘗試回填實際的首尾提交時間
      let actualSince: string | undefined
      let actualUntil: string | undefined

      if (!options.since && !options.until && !options.allTime) {
        try {
          actualSince = await collector.getFirstCommitDate(collectOptions)
          actualUntil = await collector.getLastCommitDate(collectOptions)
        } catch {
          console.log(chalk.yellow('⚠️ 無法獲取實際時間範圍，將使用預設顯示'))
        }
      }

      printResults(result, parsedData, rawData, options, effectiveSince, effectiveUntil, rangeMode, classification)

      // 判斷是否為開源專案
      const isOpenSource = classification.projectType === ProjectType.OPEN_SOURCE

      // ========== 步骤 4: 月度趨勢分析 ==========
      // 只有在分析時間跨度超過1個月時才顯示趨勢分析
      if (effectiveSince && effectiveUntil && shouldShowTrendAnalysis(effectiveSince, effectiveUntil)) {
        console.log()
        const trendSpinner = ora('📈 正在進行月度趨勢分析...').start()
        try {
          const trendResult = await TrendAnalyzer.analyzeTrend(
            path,
            effectiveSince,
            effectiveUntil,
            authorFilter?.pattern,
            (current, total, month) => {
              trendSpinner.text = `📈 正在分析月度趨勢... (${current}/${total}: ${month})`
            },
            options.timezone, // 傳遞時區過濾参數
            shouldEnableHoliday.enabled // 傳遞節假日調休模式参數
          )
          trendSpinner.succeed()
          printTrendReport(trendResult)
        } catch (error) {
          trendSpinner.fail('趨勢分析失敗')
          console.error(chalk.red('⚠️  趨勢分析錯誤:'), (error as Error).message)
        }
      }

      // ========== 步骤 5: 團隊工作模式分析 ==========
      // 開源專案不顯示團隊工作模式分析
      if (!isOpenSource && GitTeamAnalyzer.shouldAnalyzeTeam(options)) {
        try {
          const maxUsers = options.maxUsers ? parseInt(String(options.maxUsers), 10) : 30
          const teamAnalysis = await GitTeamAnalyzer.analyzeTeam(
            collectOptions,
            result.index996,
            20, // minCommits
            maxUsers,
            false // silent
          )

          if (teamAnalysis) {
            printTeamAnalysis(teamAnalysis)
          }
        } catch (error) {
          console.log(chalk.yellow('⚠️  團隊分析失敗:'), (error as Error).message)
        }
      }

      // ========== 步骤 6: 檢測跨時區並顯示警告（如果未使用 --timezone 過濾）==========
      if (rawData.timezoneData && !options.timezone) {
        const tzAnalysis = TimezoneAnalyzer.analyzeTimezone(rawData.timezoneData, rawData.byHour)
        if (tzAnalysis.isCrossTimezone) {
          console.log()
          const warningMessage = TimezoneAnalyzer.generateWarningMessage(tzAnalysis)
          console.log(chalk.yellow(warningMessage))
        }
      }
    } catch (error) {
      console.error(chalk.red('❌ 分析失敗:'), (error as Error).message)
      process.exit(1)
    }
  }
}

/**
 * 判斷是否應該顯示趨勢分析
 * 只有分析時間跨度超過1個月時才顯示
 */
function shouldShowTrendAnalysis(since: string, until: string): boolean {
  try {
    const sinceDate = new Date(since)
    const untilDate = new Date(until)
    const diffTime = untilDate.getTime() - sinceDate.getTime()
    const diffDays = diffTime / (1000 * 60 * 60 * 24)
    // 超過45天（約1.5個月）才顯示趨勢分析，避免資料太少
    return diffDays > 45
  } catch {
    return false
  }
}

interface ResolveTimeRangeParams {
  collector: GitCollector
  path: string
  options: AnalyzeOptions
  debug?: boolean
}

async function resolveTimeRange({
  collector,
  path,
  options,
}: ResolveTimeRangeParams): Promise<{ since?: string; until?: string; mode: TimeRangeMode; note?: string }> {
  if (options.allTime) {
    // --all-time 時不傳 since 和 until，讓 git 傳回所有資料
    return {
      mode: 'all-time',
    }
  }

  // 處理 --year 参數
  if (options.year) {
    const yearRange = parseYearOption(options.year)
    if (yearRange) {
      return {
        since: yearRange.since,
        until: yearRange.until,
        mode: 'custom',
        note: yearRange.note,
      }
    }
  }

  if (options.since || options.until) {
    const fallback = calculateTimeRange(false)
    return {
      since: options.since || fallback.since,
      until: options.until || fallback.until,
      mode: 'custom',
    }
  }

  const baseOptions = {
    path,
  }

  try {
    const lastCommitDate = await collector.getLastCommitDate(baseOptions)
    if (lastCommitDate) {
      const untilDate = toUTCDate(lastCommitDate)
      const sinceDate = new Date(untilDate.getTime())
      sinceDate.setUTCDate(sinceDate.getUTCDate() - 365)

      const baseline = Date.UTC(1970, 0, 1)
      if (sinceDate.getTime() < baseline) {
        sinceDate.setTime(baseline)
      }

      return {
        since: formatUTCDate(sinceDate),
        until: formatUTCDate(untilDate),
        mode: 'auto-last-commit',
        note: '以最後一次提交為基準回溯365天',
      }
    }
  } catch {}

  const fallback = calculateTimeRange(false)
  return {
    since: fallback.since,
    until: fallback.until,
    mode: 'fallback',
  }
}

/**
 * 當啟用 --self 時解析目前 Git 使用者的資訊，生成作者過濾正則
 */
async function resolveAuthorFilter(collector: GitCollector, path: string): Promise<AuthorFilterInfo> {
  const authorInfo = await collector.resolveSelfAuthor(path)
  return {
    pattern: authorInfo.pattern,
    displayLabel: authorInfo.displayLabel,
  }
}

/** 解析 --year 参數，支援單年和年份範圍 */
function parseYearOption(yearStr: string): { since: string; until: string; note?: string } | null {
  // 去除空格
  yearStr = yearStr.trim()

  // 匹配年份範圍格式：2023-2025
  const rangeMatch = yearStr.match(/^(\d{4})-(\d{4})$/)
  if (rangeMatch) {
    const startYear = parseInt(rangeMatch[1], 10)
    const endYear = parseInt(rangeMatch[2], 10)

    // 驗證年份合法性
    if (startYear < 1970 || endYear < 1970 || startYear > endYear) {
      console.error(chalk.red('❌ 年份格式錯誤: 起始年份不能大於結束年份，且年份必須 >= 1970'))
      process.exit(1)
    }

    return {
      since: `${startYear}-01-01`,
      until: `${endYear}-12-31`,
      note: `${startYear}-${endYear}年`,
    }
  }

  // 匹配單年格式：2025
  const singleMatch = yearStr.match(/^(\d{4})$/)
  if (singleMatch) {
    const year = parseInt(singleMatch[1], 10)

    // 驗證年份合法性
    if (year < 1970) {
      console.error(chalk.red('❌ 年份格式錯誤: 年份必須 >= 1970'))
      process.exit(1)
    }

    return {
      since: `${year}-01-01`,
      until: `${year}-12-31`,
      note: `${year}年`,
    }
  }

  // 格式不正確
  console.error(chalk.red('❌ 年份格式錯誤: 請使用 YYYY 格式（如 2025）或 YYYY-YYYY 格式（如 2023-2025）'))
  process.exit(1)
}

function toUTCDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map((value) => parseInt(value, 10))
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1))
}

function formatUTCDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 打印開源專案警告（使用 cli-table3） */
function printOpenSourceProjectWarning(classification: ReturnType<typeof ProjectClassifier.classify>): void {
  const { dimensions, confidence, reasoning } = classification

  console.log(chalk.yellow.bold('🌍 檢測到開源專案特征'))
  console.log()

  const terminalWidth = Math.min(getTerminalWidth(), 80)
  const warningTable = createAdaptiveTable(terminalWidth, 'stats')

  // 工作時間規律性
  const regularityEmoji = getRegularityEmoji(dimensions.workTimeRegularity.score)
  const regularityText = `${dimensions.workTimeRegularity.score}/100 ${regularityEmoji} (${dimensions.workTimeRegularity.description})`

  // 週末活跃度
  const weekendPercent = (dimensions.weekendActivity.ratio * 100).toFixed(1)
  const weekendEmoji = getWeekendEmoji(dimensions.weekendActivity.ratio)
  const weekendText = `${weekendPercent}% ${weekendEmoji} (${dimensions.weekendActivity.description})`

  // 月光族模式
  const moonlightingText = dimensions.moonlightingPattern.isActive
    ? `${dimensions.moonlightingPattern.description} 🌙`
    : '未檢測到'

  // 貢獻者數量
  const contributorsText = dimensions.contributorsCount.description

  warningTable.push(
    [
      { content: chalk.yellow(chalk.bold('工作時間規律性')), colSpan: 1 },
      { content: chalk.yellow(regularityText), colSpan: 1 },
    ],
    [
      { content: chalk.yellow(chalk.bold('貢獻者數量')), colSpan: 1 },
      { content: chalk.yellow(contributorsText), colSpan: 1 },
    ],
    [
      { content: chalk.yellow(chalk.bold('週末活跃度')), colSpan: 1 },
      { content: chalk.yellow(weekendText), colSpan: 1 },
    ],
    [
      { content: chalk.yellow(chalk.bold('晚間活跃模式')), colSpan: 1 },
      { content: chalk.yellow(moonlightingText), colSpan: 1 },
    ],
    [
      { content: chalk.yellow(chalk.bold('判斷理由')), colSpan: 1 },
      { content: chalk.yellow(reasoning), colSpan: 1 },
    ],
    [
      { content: chalk.yellow(chalk.bold('置信度')), colSpan: 1 },
      { content: chalk.yellow(`${confidence}%`), colSpan: 1 },
    ]
  )

  console.log(warningTable.toString())
  console.log()
}

/** 獲取規律性 emoji */
function getRegularityEmoji(score: number): string {
  if (score >= 75) return '✅' // 高規律性
  if (score >= 50) return '⚠️' // 中等規律性
  return '❌' // 低規律性
}

/** 獲取週末活跃度 emoji */
function getWeekendEmoji(ratio: number): string {
  if (ratio >= 0.3) return '🔥' // 很高週末活跃度
  if (ratio >= 0.15) return '⚠️' // 高週末活跃度
  return '✅' // 低週末活跃度
}

/** 輸出核心結果、時間分布與統計資訊 */
function printResults(
  result: Result996,
  parsedData: ParsedGitData,
  rawData: GitLogData,
  options: AnalyzeOptions,
  since?: string,
  until?: string,
  rangeMode?: TimeRangeMode,
  classification?: ReturnType<typeof ProjectClassifier.classify>
): void {
  const isOpenSource = classification?.projectType === ProjectType.OPEN_SOURCE

  // 如果是開源專案，隐藏核心結果、詳細分析和工作時間推測
  if (!isOpenSource) {
    printCoreResults(result, rawData, options, since, until, rangeMode)
    printDetailedAnalysis(result, parsedData)
    printWorkTimeSummary(parsedData)
  }

  printTimeDistribution(parsedData, options.halfHour) // 傳遞半小時模式参數
  printWeekdayOvertime(parsedData)
  printWeekendOvertime(parsedData)
  printLateNightAnalysis(parsedData)
}

/**
 * 判斷是否應該啟用節假日調休模式
 * @param rawData Git資料
 * @param options 使用者選項
 * @returns 是否啟用及原因
 */
function shouldEnableHolidayMode(rawData: GitLogData, options: AnalyzeOptions): { enabled: boolean; reason: string } {
  // 如果使用者強制開啟，直接啟用
  if (options.cn) {
    return {
      enabled: true,
      reason: '原因：使用者通過 --cn 参數強制開啟',
    }
  }

  // 檢測主要時區是否為 +0800
  if (rawData.timezoneData && rawData.timezoneData.timezones.length > 0) {
    // 找到占比最高的時區
    const dominantTimezone = rawData.timezoneData.timezones[0]
    const dominantRatio = dominantTimezone.count / rawData.timezoneData.totalCommits

    // 如果主要時區是 +0800 且占比超過 50%
    if (dominantTimezone.offset === '+0800' && dominantRatio >= 0.5) {
      return {
        enabled: true,
        reason: `原因：檢測到主要時區為 +0800 (占比 ${(dominantRatio * 100).toFixed(1)}%)`,
      }
    }
  }

  // 預設不啟用
  return {
    enabled: false,
    reason: '',
  }
}
