import { Command } from 'commander'
import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { getPackageVersion } from '../utils/version'
import { printGlobalNotices } from './common/notices'
import { AnalyzeOptions } from '../types/git-types'

// Re-export types for convenience
export { AnalyzeOptions }

export class CLIManager {
  private program: Command

  /** 建構函數：初始化 Commander 實例並完成命令註冊 */
  constructor() {
    this.program = new Command()
    this.setupProgram()
  }

  /** 配置 CLI 的基礎資訊與可用命令 */
  private setupProgram(): void {
    this.program
      .name('code996')
      .description('通過分析 Git commit 的時間分布，計算出專案的"996指數"')
      .version(getPackageVersion(), '-v, --version', '顯示版本號')

    // 註冊根命令預設行為，直接執行分析邏輯
    this.setupDefaultAnalyzeAction()
    this.addHelpCommand()

    // 錯誤處理
    this.setupErrorHandling()
  }

  /** 註冊根命令，支援智慧檢測單儲存庫或多儲存庫場景 */
  private setupDefaultAnalyzeAction(): void {
    this.program
      .argument('[paths...]', 'Git 儲存庫路徑（預設目前目錄，支援多個路徑）')
      .option('-s, --since <date>', '開始日期 (YYYY-MM-DD)')
      .option('-u, --until <date>', '結束日期 (YYYY-MM-DD)')
      .option('-y, --year <year>', '指定年份或年份範圍 (例如: 2025 或 2023-2025)')
      .option('--all-time', '查詢所有時間的資料（預設為最近一年）')
      .option('--self', '僅統計目前 Git 使用者的 Commit')
      .option('-H, --hours <range>', '手動指定標準工作時間 (例如: 9-18 或 9.5-18.5)')
      .option('--half-hour', '以半小時粒度展示時間分布（預設按小時展示）')
      .option('--author <regex>', '僅包含指定作者的 Commit (例如: john|mary)')
      .option('--ignore-author <regex>', '排除符合的作者 (例如: bot|jenkins)')
      .option('--ignore-msg <regex>', '排除符合的 Commit消息 (例如: merge|lint)')
      .option('--timezone <offset>', '指定時區進行分析 (例如: +0800, -0700)')
      .option('--cn', '強制開啟中國節假日調休模式（自動檢測 +0800 時區）')
      .option('--skip-user-analysis', '跳過團隊工作模式分析')
      .option('--max-users <number>', '最大分析使用者數（預設30）', '30')
      .action(async (paths: string[], options: AnalyzeOptions, command: Command) => {
        const mergedOptions = this.mergeGlobalOptions(options)

        // 智慧檢測模式
        await this.handleSmartMode(paths, mergedOptions)
      })
  }

  /** 註冊 help 命令，提供統一的幫助入口 */
  private addHelpCommand(): void {
    const helpCmd = new Command('help').description('顯示幫助資訊').action(() => {
      this.showHelp()
    })

    this.program.addCommand(helpCmd)
  }

  /** 統一註冊錯誤處理邏輯，提升使用者體驗 */
  private setupErrorHandling(): void {
    this.program.on('command:*', (operands) => {
      console.error(chalk.red(`錯誤: 未知命令 '${operands[0]}'`))
      console.log('執行 code996 -h 查看可用命令')
      process.exit(1)
    })

    this.program.on('error', (err) => {
      console.error(chalk.red('發生錯誤:'), err.message)
      process.exit(1)
    })
  }

  /**
   * 智慧模式：根據路徑和上下文自動判斷是單儲存庫還是多儲存庫分析
   */
  private async handleSmartMode(paths: string[], options: AnalyzeOptions): Promise<void> {
    const targetPaths = paths.length > 0 ? paths : [process.cwd()]

    // 情況1: 傳入多個路徑，直接進入多儲存庫模式
    if (targetPaths.length > 1) {
      console.log(chalk.cyan('💡 檢測到多個路徑，自動進入多儲存庫分析模式'))
      console.log()
      await this.handleMulti(targetPaths, options)
      return
    }

    // 情況2: 單個路徑，需要智慧判斷
    const singlePath = path.resolve(targetPaths[0])

    // 檢查路徑是否存在
    if (!fs.existsSync(singlePath)) {
      console.error(chalk.red('❌ 指定的路徑不存在:'), singlePath)
      process.exit(1)
    }

    // 檢查是否為Git儲存庫
    const isGit = await this.isGitRepository(singlePath)

    if (isGit) {
      // 是Git儲存庫，使用單儲存庫分析
      const gitRoot = this.resolveGitRoot(singlePath)
      await this.handleAnalyze(gitRoot, options)
      return
    }

    // 不是Git儲存庫，嘗試掃描子目錄
    console.log(chalk.yellow('⚠️  目前目錄不是 Git 儲存庫，正在掃描子目錄...'))
    console.log()

    const { RepoScanner } = await import('../workspace/repo-scanner')
    const repos = await RepoScanner.scanSubdirectories(singlePath)

    if (repos.length === 0) {
      console.error(chalk.red('❌ 未在目前目錄找到 Git 儲存庫'))
      console.log()
      console.log(chalk.cyan('💡 提示:'))
      console.log('  • 請在 Git 儲存庫根目錄執行 code996')
      console.log('  • 或者使用 code996 <儲存庫路徑> 指定要分析的儲存庫')
      console.log('  • 或者傳入多個路徑進行對比: code996 /path1 /path2')
      process.exit(1)
    }

    if (repos.length === 1) {
      // 只有一個子儲存庫，自動使用單儲存庫模式
      console.log(chalk.green('✓ 找到 1 個 Git 儲存庫，自動使用單儲存庫分析模式'))
      console.log(chalk.gray(`  儲存庫: ${repos[0].name}`))
      console.log()
      await this.handleAnalyze(repos[0].path, options)
      return
    }

    // 多個子儲存庫，進入多儲存庫模式（傳遞已掃描的儲存庫列表）
    console.log(chalk.cyan(`💡 找到 ${repos.length} 個 Git 儲存庫，自動進入多儲存庫分析模式`))
    console.log()
    await this.handleMulti([], options, repos)
  }

  /** 處理分析流程的執行邏輯，targetPath 為已校驗的 Git 根目錄 */
  private async handleAnalyze(targetPath: string, options: AnalyzeOptions): Promise<void> {
    // 預設以目前工作目錄作為分析目標，保持使用體驗簡單
    // 導入analyze命令並執行
    const mergedOptions = this.mergeGlobalOptions(options)
    const { AnalyzeExecutor } = await import('./commands/analyze')
    await AnalyzeExecutor.execute(targetPath, mergedOptions)
    printGlobalNotices()
  }

  /** 處理多儲存庫分析流程的執行邏輯 */
  private async handleMulti(dirs: string[], options: AnalyzeOptions, preScannedRepos?: any[]): Promise<void> {
    const mergedOptions = this.mergeGlobalOptions(options)
    const { MultiExecutor } = await import('./commands/multi')
    await MultiExecutor.execute(dirs, mergedOptions, preScannedRepos)
    printGlobalNotices()
  }

  /** 合併全局選項（解決子命令無法直接讀取根命令參數的問題） */
  private mergeGlobalOptions(options: AnalyzeOptions): AnalyzeOptions {
    const globalOpts = this.program.opts<AnalyzeOptions>()
    return {
      ...options,
      self: options.self ?? globalOpts.self,
      allTime: options.allTime ?? globalOpts.allTime,
      since: options.since ?? globalOpts.since,
      until: options.until ?? globalOpts.until,
      year: options.year ?? globalOpts.year,
      hours: options.hours ?? globalOpts.hours,
      halfHour: options.halfHour ?? globalOpts.halfHour,
      author: options.author ?? globalOpts.author,
      ignoreAuthor: options.ignoreAuthor ?? globalOpts.ignoreAuthor,
      ignoreMsg: options.ignoreMsg ?? globalOpts.ignoreMsg,
      timezone: options.timezone ?? globalOpts.timezone,
    }
  }

  /**
   * 檢查指定目錄是否為 Git 儲存庫
   */
  private async isGitRepository(dirPath: string): Promise<boolean> {
    try {
      // 檢查 .git 目錄是否存在
      const gitDir = path.join(dirPath, '.git')
      if (fs.existsSync(gitDir)) {
        return true
      }

      // 使用 git 命令檢查
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: dirPath,
        stdio: 'ignore',
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * 解析 Git 儲存庫的根目錄
   */
  private resolveGitRoot(dirPath: string): string {
    try {
      const gitRoot = execSync('git rev-parse --show-toplevel', {
        cwd: dirPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .toString()
        .trim()

      return fs.realpathSync(gitRoot)
    } catch {
      // 如果獲取失敗，傳回原路徑
      return fs.realpathSync(dirPath)
    }
  }

  /** 解析並校驗儲存庫路徑，確保使用者位于 Git 儲存庫根目錄（僅用於向後相容） */
  private resolveTargetPath(repoPathArg: string | undefined, commandLabel: string): string {
    const candidatePath = path.resolve(repoPathArg ?? process.cwd())

    if (!fs.existsSync(candidatePath)) {
      console.error(chalk.red('❌ 指定的目錄不存在:'), candidatePath)
      console.log(chalk.yellow('請確認路徑是否正確，或在 Git 儲存庫根目錄執行命令。'))
      process.exit(1)
    }

    const stat = fs.statSync(candidatePath)
    if (!stat.isDirectory()) {
      console.error(chalk.red('❌ 指定路徑不是目錄:'), candidatePath)
      console.log(chalk.yellow('請傳入 Git 儲存庫根目錄，而不是單個文件。'))
      process.exit(1)
    }

    let gitRootRaw: string
    try {
      gitRootRaw = execSync('git rev-parse --show-toplevel', {
        cwd: candidatePath,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .toString()
        .trim()
    } catch {
      console.error(chalk.red('❌ 未檢測到有效的 Git 儲存庫:'), candidatePath)
      console.log(chalk.yellow('請在 Git 儲存庫根目錄執行命令，或在命令末尾追加 Git 儲存庫路徑，例如：'))
      console.log(chalk.cyan(`  ${commandLabel} /path/to/your/repo`))
      process.exit(1)
    }

    const normalizedCandidate = fs.realpathSync(candidatePath)
    const normalizedRoot = fs.realpathSync(gitRootRaw)

    if (normalizedCandidate !== normalizedRoot) {
      this.printGitRootWarning(normalizedCandidate, normalizedRoot, commandLabel)
    }

    return normalizedRoot
  }

  /** 強提示目前路徑非 Git 根目錄，並指引使用者的正確使用方式 */
  private printGitRootWarning(currentPath: string, rootPath: string, commandLabel: string): never {
    console.error(chalk.bgRed.white(' ⚠️ 目前目錄不是 Git 儲存庫根目錄 '))
    console.error(chalk.red(`目前目錄: ${currentPath}`))
    console.error(chalk.green(`儲存庫根目錄: ${rootPath}`))
    console.log(chalk.yellow('請在儲存庫根目錄執行命令，或直接在命令末尾追加根目錄路徑，例如：'))
    console.log(chalk.cyan(`  ${commandLabel} ${rootPath}`))
    console.log(chalk.yellow('提示: 若你在子目錄中，請先 cd 到上面的儲存庫根目錄後再執行。'))
    process.exit(1)
  }

  /** 自定義幫助資訊展示，補充常用示例 */
  private showHelp(): void {
    // 使用更紧凑的 CODE996 字符图，避免在窄終端中被截斷
    const banner = `
 ████    ████   █████   ██████   ████    ████    ████
██  ██  ██  ██  ██  ██  ██      ██  ██  ██  ██  ██
██      ██  ██  ██  ██  █████    █████   █████  █████
██  ██  ██  ██  ██  ██  ██          ██      ██  ██  ██
 ████    ████   █████   ██████   ████    ████    ████
`

    console.log(chalk.hex('#D72654')(banner))
    console.log(`> 統計 Git 專案的 commit 時間分布，進而推導出專案的 Coding 工作強度。

${chalk.bold('使用方法:')}
  code996 [路徑...] [選項]

${chalk.bold('命令:')}
  help              顯示幫助資訊

${chalk.bold('智慧分析模式:')}
  code996 會自動檢測並選擇最合適的分析模式：

  ${chalk.cyan('●')} ${chalk.bold('單儲存庫深度分析')}
    • 在 Git 儲存庫中執行 code996
    • 或指定單個儲存庫路徑: code996 /path/to/repo
    → 深度分析單個專案，包含月度趨勢

  ${chalk.cyan('●')} ${chalk.bold('多儲存庫横向對比')}
    • 傳入多個路徑: code996 /path1 /path2
    • 或在有多個子儲存庫的目錄執行
    → 自動進入多儲存庫模式，彙總分析

${chalk.bold('全局選項:')}
  -v, --version     顯示版本號
  -h, --help        顯示幫助資訊

${chalk.bold('分析選項:')}
  -s, --since <date>      開始日期 (YYYY-MM-DD)
  -u, --until <date>      結束日期 (YYYY-MM-DD)
  -y, --year <year>       指定年份或年份範圍 (例如: 2025 或 2023-2025)
  --all-time              查詢所有時間的資料（涵蓋整個儲存庫歷史）
  --self                  僅統計目前 Git 使用者的 Commit
  -H, --hours <range>     手動指定標準工作時間 (例如: 9-18 或 9.5-18.5)
  --half-hour             以半小時粒度展示時間分布（預設按小時展示）
  --author <regex>        僅包含指定作者的 Commit (例如: john|mary)
  --ignore-author <regex> 排除符合的作者 (例如: bot|jenkins)
  --ignore-msg <regex>    排除符合的 Commit 消息 (例如: merge|lint)

${chalk.bold('預設策略:')}
  自動以最後一次 Commit為基準，回溯365天進行分析

${chalk.bold('示例:')}
  ${chalk.gray('# 單儲存庫分析')}
  code996                       # 分析目前儲存庫（最近一年）
  code996 /path/to/repo         # 分析指定儲存庫
  code996 -y 2025               # 分析2025年整年
  code996 --self                # 只統計目前使用者的 Commit
  code996 --ignore-author "bot" # 排除 Bot Commit

  ${chalk.gray('# 多儲存庫分析')}
  code996 /proj1 /proj2         # 傳入多個路徑，自動分析多個儲存庫
  code996 /workspace            # 子目錄有多個儲存庫，自動進入多儲存庫模式
  code996 -y 2024 --self        # 組合使用，分析2024年自己的 Commit

  ${chalk.gray('# 過濾資料')}
  code996 --author "john"       # 只分析 john 的 Commit
  code996 --author "john|mary"  # 只分析 john 或 mary 的 Commit
  code996 --ignore-author "bot" # 排除所有包含 "bot" 的作者
  code996 --ignore-author "bot|jenkins|github-actions"  # 排除多個作者（使用 | 分隔）
  code996 --ignore-msg "^Merge" # 排除所有以 "Merge" 開頭的 Commit消息
  code996 --ignore-msg "merge|lint|format"  # 排除多個關鍵詞

${chalk.bold('正則表達式語法說明:')}
  - 使用 | 分隔多個模式 (例如: bot|jenkins)
  - 使用 ^ 符合開頭 (例如: ^Merge)
  - 使用 $ 符合結尾 (例如: fix$)
  - 使用 .* 符合任意字符 (例如: bot.*)
  - 預設不區分大小写

${chalk.bold('更多詳情請存取:')} https://github.com/hellodigua/code996

${chalk.bold('繁體中文 fork:')} https://github.com/unayung/code996
    `)
  }

  
  /** 啟动 CLI 参數解析入口 */
  parse(argv: string[]): void {
    this.program.parse(argv)
  }
}
